import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { messagingApi } from '@line/bot-sdk';
import { ReminderQuery, ReminderRecord } from '../reminders/reminder.types';

@Injectable()
export class LineFlexMessageFactory {
  constructor(private readonly config: ConfigService) {}

  buildConfirmationMessage(records: ReminderRecord[]): messagingApi.FlexMessage {
    const bubbles = records.map((record) => this.buildConfirmationBubble(record));

    return {
      type: 'flex',
      altText: `บันทึกการเตือนเรียบร้อย ${records.length} รายการ`,
      contents: bubbles.length === 1 ? bubbles[0] : { type: 'carousel', contents: bubbles.slice(0, 12) },
    };
  }

  buildReminderListMessage(title: string, records: ReminderRecord[]): messagingApi.FlexMessage {
    const oneTime = records.filter((record) => !record.recurrence);
    const recurring = records.filter((record) => record.recurrence);

    return {
      type: 'flex',
      altText: title,
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
              text: title,
              weight: 'bold',
              size: 'lg',
              wrap: true,
            },
            { type: 'separator', margin: 'sm' },
            ...this.buildReminderSection('ครั้งเดียว', oneTime),
            ...this.buildReminderSection('ซ้ำ', recurring),
          ],
        },
      },
    };
  }

  buildCancelConfirmationMessage(record: ReminderRecord): messagingApi.FlexMessage {
    return {
      type: 'flex',
      altText: `ยืนยันยกเลิก: ${record.title}`,
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
              text: 'ยืนยันยกเลิก?',
              weight: 'bold',
              size: 'lg',
            },
            this.textLine(record.title),
            this.textLine(`${this.formatDate(record.dueAt, record.timezone)} ${this.formatTime(record.dueAt, record.timezone)}`),
            ...(record.recurrence ? [this.textLine(this.formatRecurrence(record))] : []),
            {
              type: 'button',
              style: 'primary',
              color: '#D92D20',
              margin: 'lg',
              action: {
                type: 'postback',
                label: 'ยืนยันยกเลิก',
                data: `action=cancel_confirm&id=${record.id}`,
              },
            },
            {
              type: 'button',
              style: 'secondary',
              action: {
                type: 'postback',
                label: 'ไม่ยกเลิก',
                data: `action=cancel_abort&id=${record.id}`,
              },
            },
          ],
        },
      },
    };
  }

  buildCancelSelectionMessage(title: string, records: ReminderRecord[]): messagingApi.FlexMessage {
    return this.buildReminderListMessage(title, records.slice(0, 20));
  }

  buildNotificationMessage(record: ReminderRecord): messagingApi.FlexMessage {
    const imageUrl = this.config.get<string>('REMINDER_IMAGE_URL');

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
          contents: [
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
          ],
        },
      },
    };
  }

  private buildConfirmationBubble(record: ReminderRecord): messagingApi.FlexBubble {
    return {
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
          this.textLine(`วันที่: ${this.formatDate(record.dueAt, record.timezone)}`),
          this.textLine(`เวลา: ${this.formatTime(record.dueAt, record.timezone)}`),
          this.textLine(`เรื่อง: ${record.title}`),
          ...(record.recurrence ? [this.textLine(`ซ้ำ: ${this.formatRecurrence(record)}`)] : []),
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
              data: `action=cancel_request&id=${record.id}`,
            },
          },
        ],
      },
    };
  }

  private buildReminderSection(title: string, records: ReminderRecord[]): messagingApi.FlexComponent[] {
    return [
      {
        type: 'text',
        text: title,
        weight: 'bold',
        size: 'md',
        margin: 'lg',
      },
      ...(records.length
        ? records.slice(0, 10).map((record) => this.buildReminderRow(record))
        : [
            {
              type: 'text',
              text: 'ไม่มีรายการ',
              color: '#8C8C8C',
              size: 'sm',
              margin: 'sm',
            } satisfies messagingApi.FlexComponent,
          ]),
    ];
  }

  private buildReminderRow(record: ReminderRecord): messagingApi.FlexComponent {
    return {
      type: 'box',
      layout: 'vertical',
      margin: 'md',
      paddingAll: '10px',
      backgroundColor: '#F7F8FA',
      cornerRadius: '8px',
      contents: [
        {
          type: 'text',
          text: record.title,
          weight: 'bold',
          size: 'sm',
          wrap: true,
        },
        {
          type: 'text',
          text: `${this.formatStatus(record.status)} | ${this.formatDate(record.dueAt, record.timezone)} ${this.formatTime(record.dueAt, record.timezone)}`,
          size: 'xs',
          color: '#667085',
          wrap: true,
          margin: 'xs',
        },
        ...(record.recurrence
          ? [
              {
                type: 'text',
                text: this.formatRecurrence(record),
                size: 'xs',
                color: '#667085',
                wrap: true,
                margin: 'xs',
              } satisfies messagingApi.FlexComponent,
            ]
          : []),
        {
          type: 'button',
          style: 'secondary',
          height: 'sm',
          margin: 'sm',
          action: {
            type: 'postback',
            label: 'ยกเลิก',
            data: `action=cancel_request&id=${record.id}`,
          },
        },
      ],
    };
  }

  textListFallback(title: string, query: ReminderQuery, records: ReminderRecord[]) {
    if (records.length === 0) {
      return `ยังไม่มี${query.title}ในแชตนี้`;
    }

    const lines = records.slice(0, 20).map((record, index) => {
      const recurrence = record.recurrence ? ` (${this.formatRecurrence(record)})` : '';
      return `${index + 1}. [${this.formatStatus(record.status)}] ${this.formatDate(record.dueAt, record.timezone)} ${this.formatTime(record.dueAt, record.timezone)} - ${record.title}${recurrence}`;
    });

    const suffix = records.length > 20 ? `\n\nแสดง 20 จาก ${records.length} รายการ` : '';
    return `${title}\n${lines.join('\n')}${suffix}`;
  }

  private textLine(text: string): messagingApi.FlexComponent {
    return {
      type: 'text',
      text,
      size: 'md',
      wrap: true,
    };
  }

  private formatStatus(status: ReminderRecord['status']) {
    const labels: Record<ReminderRecord['status'], string> = {
      pending: 'รอเตือน',
      completed: 'เสร็จแล้ว',
      cancelled: 'ยกเลิก',
      sent: 'เตือนแล้ว',
    };

    return labels[status];
  }

  private formatRecurrence(record: ReminderRecord) {
    const recurrence = record.recurrence;
    if (!recurrence) {
      return '';
    }

    if (recurrence.frequency === 'daily') {
      return recurrence.interval === 1 ? 'ทุกวัน' : `ทุก ${recurrence.interval} วัน`;
    }

    const days = recurrence.daysOfWeek?.length
      ? recurrence.daysOfWeek.map((day) => this.formatDayOfWeek(day)).join(', ')
      : 'สัปดาห์';

    return recurrence.interval === 1 ? `ทุก${days}` : `ทุก ${recurrence.interval} สัปดาห์ (${days})`;
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

  private formatDayOfWeek(day: number) {
    const labels = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัส', 'ศุกร์', 'เสาร์'];
    return labels[day] ?? `วันที่ ${day}`;
  }
}
