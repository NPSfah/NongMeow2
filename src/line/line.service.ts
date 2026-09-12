import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { messagingApi } from '@line/bot-sdk';
import { randomUUID } from 'crypto';
import { GeminiReminderParser } from '../reminders/gemini-reminder.parser';
import { ReminderStore } from '../reminders/reminder.store';
import { BotIntent, ReminderQuery, ReminderRecord } from '../reminders/reminder.types';
import { LineFlexMessageFactory } from './line-flex-message.factory';
import { LineMessageEvent, LinePostbackEvent, LineSource, LineWebhookBody, LineWebhookEvent } from './line.types';

@Injectable()
export class LineService implements OnModuleInit {
  private readonly logger = new Logger(LineService.name);
  private readonly client: messagingApi.MessagingApiClient;

  constructor(
    private readonly config: ConfigService,
    private readonly parser: GeminiReminderParser,
    private readonly reminders: ReminderStore,
    private readonly flex: LineFlexMessageFactory,
  ) {
    this.client = new messagingApi.MessagingApiClient({
      channelAccessToken: this.config.get<string>('LINE_CHANNEL_ACCESS_TOKEN') ?? '',
    });
  }

  onModuleInit() {
    if (!this.config.get<string>('LINE_CHANNEL_ACCESS_TOKEN')) {
      this.logger.warn('LINE_CHANNEL_ACCESS_TOKEN is not configured');
    }

    this.reminders.setDueHandler((record) => this.sendReminder(record));
  }

  async handleWebhook(body: LineWebhookBody) {
    for (const event of body.events ?? []) {
      try {
        this.logger.log(`Handling LINE event: ${event.type}`);
        await this.handleEvent(event);
      } catch (error) {
        this.logger.error(`LINE event failed: ${event.type}`, error);
      }
    }
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
      this.logger.log(`Ignored message from ${event.source.type}; bot was not mentioned`);
      return;
    }

    const text = this.stripSelfMention(event.message.text, event.message.mention?.mentionees);
    this.logger.log(`Parsing reminder text from ${event.source.type}: ${text}`);
    await this.showThinking(event);

    let intent: BotIntent;

    try {
      intent = await this.parser.parse(text);
    } catch (error) {
      this.logger.warn(`Could not parse bot intent: ${String(error)}`);
      await this.replyText(
        event.replyToken,
        'ยังบันทึกไม่ได้ ลองพิมพ์วัน เวลา และเรื่องที่ต้องเตือนให้ชัดขึ้นหน่อยนะ',
      );
      return;
    }

    if (intent.intent === 'list_reminders') {
      const records = await this.reminders.queryByTarget(this.getTargetId(event.source), intent.query);
      await this.sendFinalResponse(event, this.buildReminderListResponse(intent.query, records));
      return;
    }

    if (intent.intent === 'cancel_reminders') {
      await this.handleCancelIntent(event, intent.query);
      return;
    }

    if (intent.intent === 'unknown') {
      await this.sendFinalResponse(event, { type: 'text', text: intent.message });
      return;
    }

    const now = new Date().toISOString();
    const targetId = this.getTargetId(event.source);
    const records = await Promise.all(
      intent.reminders.map((parsed) =>
        this.reminders.create({
          id: randomUUID(),
          sourceType: event.source.type,
          targetId,
          createdByUserId: this.getUserId(event.source),
          rawText: event.message.text,
          title: parsed.title,
          dueAt: parsed.dueAt,
          timezone: parsed.timezone,
          recurrence: parsed.recurrence,
          status: 'pending',
          createdAt: now,
          updatedAt: now,
        }),
      ),
    );

    this.logger.log(`Created ${records.length} reminder(s): ${records.map((record) => record.id).join(', ')}`);
    await this.sendFinalResponse(event, this.flex.buildConfirmationMessage(records));
  }

  private async handlePostback(event: LinePostbackEvent) {
    const params = new URLSearchParams(event.postback.data);
    const action = params.get('action');
    const id = params.get('id');

    if (!id || !action) {
      return;
    }

    const targetId = this.getTargetId(event.source);

    if (action === 'cancel_request') {
      const record = await this.reminders.getById(targetId, id);
      await this.replyMessage(
        event.replyToken,
        record ? this.flex.buildCancelConfirmationMessage(record) : { type: 'text', text: 'ไม่พบรายการเตือนนี้แล้ว' },
      );
      return;
    }

    if (action === 'cancel_abort') {
      await this.replyText(event.replyToken, 'โอเค ไม่ยกเลิกแล้ว');
      return;
    }

    if (action === 'complete' || action === 'cancel_confirm') {
      const status = action === 'complete' ? 'completed' : 'cancelled';
      const record = await this.reminders.updateStatus(id, status);
      this.logger.log(`Postback ${action} for reminder ${id}: ${record ? 'updated' : 'not found'}`);

      await this.replyText(
        event.replyToken,
        record
          ? action === 'complete'
            ? 'รับทราบ ทำเสร็จแล้ว จะไม่เตือนรายการนี้'
            : 'ยกเลิกการเตือนรายการนี้แล้ว'
          : 'ไม่พบรายการเตือนนี้แล้ว',
      );
    }
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
      messages: [this.flex.buildNotificationMessage(record)],
    });
  }

  private async showThinking(event: LineMessageEvent) {
    if (event.source.type === 'user') {
      try {
        await this.client.showLoadingAnimation({
          chatId: event.source.userId,
          loadingSeconds: 10,
        });
      } catch (error) {
        this.logger.warn(`Could not show loading animation: ${String(error)}`);
      }
      return;
    }

    await this.replyText(event.replyToken, 'กำลังคิดให้นะ...');
  }

  private async sendFinalResponse(event: LineMessageEvent, message: messagingApi.Message) {
    if (event.source.type === 'user') {
      await this.replyMessage(event.replyToken, message);
      return;
    }

    await this.client.pushMessage({
      to: this.getTargetId(event.source),
      messages: [message],
    });
  }

  private async handleCancelIntent(event: LineMessageEvent, query: ReminderQuery) {
    const records = await this.reminders.queryByTarget(this.getTargetId(event.source), query);

    if (records.length === 0) {
      await this.sendFinalResponse(event, { type: 'text', text: 'ไม่เจองานที่ตรงกับที่บอก' });
      return;
    }

    if (records.length === 1) {
      await this.sendFinalResponse(event, this.flex.buildCancelConfirmationMessage(records[0]));
      return;
    }

    await this.sendFinalResponse(event, this.flex.buildCancelSelectionMessage('เลือกงานที่จะยกเลิก', records));
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

  private buildReminderListResponse(query: ReminderQuery, records: ReminderRecord[]): messagingApi.Message {
    if (records.length === 0) {
      return {
        type: 'text',
        text: `ยังไม่มี${query.title}ในแชตนี้`,
      };
    }

    return this.flex.buildReminderListMessage(`${query.title}ในแชตนี้`, records);
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

  private isMessageEvent(event: LineWebhookEvent): event is LineMessageEvent {
    return event.type === 'message' && (event as LineMessageEvent).message?.type === 'text';
  }

  private isPostbackEvent(event: LineWebhookEvent): event is LinePostbackEvent {
    return event.type === 'postback';
  }
}
