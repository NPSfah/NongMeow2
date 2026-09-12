import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { messagingApi } from '@line/bot-sdk';
import { randomUUID } from 'crypto';
import { GeminiReminderParser } from '../reminders/gemini-reminder.parser';
import { ReminderStore } from '../reminders/reminder.store';
import { ParsedReminder, ReminderRecord } from '../reminders/reminder.types';
import { LineMessageEvent, LinePostbackEvent, LineSource, LineWebhookBody, LineWebhookEvent } from './line.types';

@Injectable()
export class LineService implements OnModuleInit {
  private readonly logger = new Logger(LineService.name);
  private readonly client: messagingApi.MessagingApiClient;

  constructor(
    private readonly config: ConfigService,
    private readonly parser: GeminiReminderParser,
    private readonly reminders: ReminderStore,
  ) {
    this.client = new messagingApi.MessagingApiClient({
      channelAccessToken: this.config.get<string>('LINE_CHANNEL_ACCESS_TOKEN') ?? '',
    });
  }

  onModuleInit() {
    this.reminders.setDueHandler((record) => this.sendReminder(record));
  }

  async handleWebhook(body: LineWebhookBody) {
    await Promise.all((body.events ?? []).map((event) => this.handleEvent(event)));
  }

  private async handleEvent(event: LineWebhookEvent) {
    if (this.isMessageEvent(event)) {
      await this.handleMessage(event);
      return;
    }

    if (this.isPostbackEvent(event)) {
      await this.handlePostback(event);
    }
  }

  private async handleMessage(event: LineMessageEvent) {
    if (!this.shouldHandleMessage(event)) {
      return;
    }

    const text = this.stripSelfMention(event.message.text, event.message.mention?.mentionees);
    let parsed: ParsedReminder;

    try {
      parsed = await this.parser.parse(text);
    } catch (error) {
      this.logger.warn(`Could not parse reminder: ${String(error)}`);
      await this.replyText(
        event.replyToken,
        'ยังบันทึกไม่ได้ ลองพิมพ์วัน เวลา และเรื่องที่ต้องเตือนให้ชัดขึ้นหน่อยนะ',
      );
      return;
    }

    const now = new Date().toISOString();
    const record = await this.reminders.create({
      id: randomUUID(),
      sourceType: event.source.type,
      targetId: this.getTargetId(event.source),
      createdByUserId: this.getUserId(event.source),
      rawText: event.message.text,
      title: parsed.title,
      dueAt: parsed.dueAt,
      timezone: parsed.timezone,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
    });

    await this.replyMessage(event.replyToken, this.buildConfirmationMessage(record));
  }

  private async handlePostback(event: LinePostbackEvent) {
    const params = new URLSearchParams(event.postback.data);
    const action = params.get('action');
    const id = params.get('id');

    if (!id || (action !== 'complete' && action !== 'cancel')) {
      return;
    }

    const status = action === 'complete' ? 'completed' : 'cancelled';
    const record = await this.reminders.updateStatus(id, status);

    await this.replyText(
      event.replyToken,
      record
        ? action === 'complete'
          ? 'รับทราบ ทำเสร็จแล้ว จะไม่เตือนรายการนี้'
          : 'ยกเลิกการเตือนรายการนี้แล้ว'
        : 'ไม่พบรายการเตือนนี้แล้ว',
    );
  }

  private shouldHandleMessage(event: LineMessageEvent) {
    if (event.message.type !== 'text') {
      return false;
    }

    if (event.source.type === 'user') {
      return true;
    }

    return event.message.mention?.mentionees?.some((mentionee) => mentionee.isSelf) ?? false;
  }

  private stripSelfMention(
    text: string,
    mentionees?: Array<{ index: number; length: number; isSelf?: boolean }>,
  ) {
    const selfMention = mentionees?.find((mentionee) => mentionee.isSelf);
    if (!selfMention) {
      return text.trim();
    }

    return `${text.slice(0, selfMention.index)}${text.slice(selfMention.index + selfMention.length)}`.trim();
  }

  private async sendReminder(record: ReminderRecord) {
    await this.client.pushMessage({
      to: record.targetId,
      messages: [this.buildNotificationMessage(record)],
    });
  }

  private async replyText(replyToken: string, text: string) {
    await this.replyMessage(replyToken, {
      type: 'text',
      text,
    });
  }

  private async replyMessage(replyToken: string, message: messagingApi.Message) {
    await this.client.replyMessage({
      replyToken,
      messages: [message],
    });
  }

  private buildConfirmationMessage(record: ReminderRecord): messagingApi.FlexMessage {
    const date = this.formatDate(record.dueAt, record.timezone);
    const time = this.formatTime(record.dueAt, record.timezone);

    return {
      type: 'flex',
      altText: `บันทึกการเตือนเรียบร้อย: ${record.title}`,
      contents: {
        type: 'bubble',
        size: 'mega',
        body: {
          type: 'box',
          layout: 'vertical',
          spacing: 'md',
          contents: [
            {
              type: 'text',
              text: 'บันทึกการเตือนเรียบร้อย',
              weight: 'bold',
              size: 'lg',
            },
            { type: 'separator', margin: 'md' },
            this.textLine(`วันที่: ${date}`),
            this.textLine(`เวลา: ${time}`),
            this.textLine(`เรื่อง: ${record.title}`),
            {
              type: 'button',
              style: 'primary',
              color: '#1DB446',
              margin: 'lg',
              action: {
                type: 'postback',
                label: 'ทำเสร็จแล้ว ไม่ต้องเตือน',
                data: `action=complete&id=${record.id}`,
              },
            },
            {
              type: 'button',
              style: 'secondary',
              action: {
                type: 'postback',
                label: 'ยกเลิกการเตือน',
                data: `action=cancel&id=${record.id}`,
              },
            },
          ],
        },
      },
    };
  }

  private buildNotificationMessage(record: ReminderRecord): messagingApi.FlexMessage {
    const imageUrl = this.config.get<string>('REMINDER_IMAGE_URL');
    const contents: messagingApi.FlexComponent[] = [
      {
        type: 'text',
        text: 'นี่ฮ่ะ อย่าลืมอันนี้นะ',
        weight: 'bold',
        size: 'xl',
        wrap: true,
      },
      {
        type: 'text',
        text: record.title,
        size: 'md',
        wrap: true,
        margin: 'sm',
      },
      {
        type: 'button',
        style: 'primary',
        color: '#1DB446',
        margin: 'lg',
        action: {
          type: 'postback',
          label: 'ทำเสร็จแล้ว',
          data: `action=complete&id=${record.id}`,
        },
      },
    ];

    return {
      type: 'flex',
      altText: `เตือน: ${record.title}`,
      contents: {
        type: 'bubble',
        hero: imageUrl
          ? {
              type: 'image',
              url: imageUrl,
              size: 'full',
              aspectRatio: '20:13',
              aspectMode: 'cover',
            }
          : undefined,
        body: {
          type: 'box',
          layout: 'vertical',
          spacing: 'md',
          contents,
        },
      },
    };
  }

  private textLine(text: string): messagingApi.FlexComponent {
    return {
      type: 'text',
      text,
      size: 'md',
      wrap: true,
    };
  }

  private getTargetId(source: LineSource) {
    if (source.type === 'group') {
      return source.groupId;
    }

    if (source.type === 'room') {
      return source.roomId;
    }

    return source.userId;
  }

  private getUserId(source: LineSource) {
    return 'userId' in source ? source.userId : undefined;
  }

  private formatDate(iso: string, timezone: string) {
    return new Intl.DateTimeFormat('th-TH', {
      timeZone: timezone,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(new Date(iso));
  }

  private formatTime(iso: string, timezone: string) {
    return new Intl.DateTimeFormat('th-TH', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(iso));
  }

  private isMessageEvent(event: LineWebhookEvent): event is LineMessageEvent {
    return event.type === 'message' && (event as LineMessageEvent).message?.type === 'text';
  }

  private isPostbackEvent(event: LineWebhookEvent): event is LinePostbackEvent {
    return event.type === 'postback';
  }
}
