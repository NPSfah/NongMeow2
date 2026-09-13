import { Injectable } from '@nestjs/common';
import { BotIntent, ReminderQuery } from './reminder.types';

export type LocalCommandResult =
  | BotIntent
  | {
      intent: 'direct_reply';
      text: string;
    };

@Injectable()
export class LocalCommandParser {
  parse(text: string): LocalCommandResult | undefined {
    const command = this.normalize(text);

    if (this.matches(command, ['help', 'h', '?', 'ช่วยเหลือ', 'คำสั่ง', 'สอนใช้'])) {
      return {
        intent: 'direct_reply',
        text: [
          'คำสั่งที่ใช้ได้:',
          '- บอกงาน + วัน/เวลา เช่น "พรุ่งนี้ 8 โมง ปลุกไปเรียน"',
          '- list / รายการ: ดูงานที่ยังไม่เสร็จ',
          '- ซ้ำ: ดูงานที่เตือนซ้ำ',
          '- ครั้งเดียว: ดูงานที่ไม่เตือนซ้ำ',
          '- เลยกำหนด: ดูงานค้าง',
          '- ยกเลิกงาน... เช่น "ยกเลิกงานประชุมพรุ่งนี้"',
        ].join('\n'),
      };
    }

    if (this.matches(command, ['list', 'รายการ', 'ทั้งหมด', 'งานทั้งหมด', 'list all', 'all'])) {
      return this.listIntent('รายการเตือน');
    }

    if (this.matches(command, ['recurring', 'repeat', 'ซ้ำ', 'งานซ้ำ', 'รายการซ้ำ', 'list recurring'])) {
      return this.listIntent('รายการเตือนซ้ำ', { recurrence: 'recurring' });
    }

    if (
      this.matches(command, [
        'once',
        'one time',
        'non recurring',
        'non-recurring',
        'ครั้งเดียว',
        'งานครั้งเดียว',
        'รายการครั้งเดียว',
        'list once',
      ])
    ) {
      return this.listIntent('รายการเตือนครั้งเดียว', { recurrence: 'non-recurring' });
    }

    if (this.matches(command, ['overdue', 'late', 'เลยกำหนด', 'งานค้าง', 'รายการค้าง'])) {
      return this.listIntent('รายการเลยกำหนด', { overdueOnly: true });
    }

    if (this.matches(command, ['cancel help', 'วิธียกเลิก', 'ยกเลิกยังไง'])) {
      return {
        intent: 'direct_reply',
        text: 'พิมพ์ยกเลิกตามด้วยชื่องานหรือเวลา เช่น "ยกเลิกงานประชุมพรุ่งนี้" แล้วบอทจะให้กดยืนยันก่อนลบ',
      };
    }

    return undefined;
  }

  private listIntent(title: string, override: Partial<ReminderQuery> = {}): BotIntent {
    return {
      intent: 'list_reminders',
      query: {
        title,
        recurrence: 'all',
        includeFinished: false,
        overdueOnly: false,
        ...override,
      },
    };
  }

  private matches(command: string, candidates: string[]) {
    return candidates.includes(command);
  }

  private normalize(text: string) {
    return text
      .trim()
      .replace(/^[/!]+/, '')
      .replace(/\s+/g, ' ')
      .toLowerCase();
  }
}
