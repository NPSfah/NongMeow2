import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI, Type } from '@google/genai';
import { BotIntent, ParsedReminder, ReminderQuery } from './reminder.types';

@Injectable()
export class GeminiReminderParser {
  constructor(private readonly config: ConfigService) {}

  async parse(text: string): Promise<BotIntent> {
    const apiKey = this.config.get<string>('GEMINI_API_KEY');
    const timezone = this.config.get<string>('APP_TIMEZONE') ?? 'Asia/Bangkok';

    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not configured');
    }

    const ai = new GoogleGenAI({ apiKey });
    const now = new Date().toISOString();
    const model = this.config.get<string>('GEMINI_MODEL') ?? 'gemini-3.6-flash';

    const response = await ai.models.generateContent({
      model,
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: [
                'Classify this LINE bot message into one intent: create_reminders, list_reminders, cancel_reminders, or unknown.',
                'The message may be Thai, English, or mixed.',
                'Return only structured JSON that matches the schema.',
                'If the message is addressed to the bot with a mention, ignore the mention text.',
                'For create_reminders: extract one or more LINE reminder records from the message.',
                'A create message can contain multiple reminders, separated by new lines, punctuation, or natural phrasing.',
                'If a create reminder repeats forever or on a regular schedule, return one reminder with a recurrence object.',
                'For create phrases like "every Sunday", use frequency weekly, interval 1, and daysOfWeek [0]. Sunday is 0, Monday is 1, Tuesday is 2, Wednesday is 3, Thursday is 4, Friday is 5, Saturday is 6.',
                'For create phrases like "every day", use frequency daily and interval 1.',
                'If a create reminder repeats only across a bounded range like "all week", expand it into one reminder per day instead of making it recurring.',
                'If a vague time is used, choose a practical default: morning 08:00, afternoon 13:00, evening 18:00, night 21:00.',
                'If the user gives a relative date or time, resolve it from the provided current time and timezone.',
                'For list_reminders: return a query object instead of reminders.',
                'List examples include: "ตอนนี้มีงานไรบ้าง", "งานสัปดาห์นี้มีไรบ้าง", "งานที่ส่งพุธหน้า", "งานที่ยังไม่เสร็จ", "รายการทั้งหมดรวมเสร็จแล้ว", "list recurring", "overdue".',
                'Default list behavior must hide finished items: includeFinished false unless the user asks for all items, completed items, finished items, cancelled items, or "รวมเสร็จแล้ว".',
                'For "งานที่ยังไม่เสร็จ" or unfinished tasks, use includeFinished false.',
                'For overdue queries, set overdueOnly true and do not set dueFrom or dueTo unless the user also gives a date range.',
                'For recurring-only queries, set recurrence recurring. For one-time/non-recurring-only queries, set recurrence non-recurring. Otherwise use all.',
                'For "this week", set dueFrom and dueTo to the local week range. For "next Wednesday", make dueFrom and dueTo cover that local day.',
                'Set query.title to a short Thai label suitable as the reply heading.',
                'For cancel_reminders: return a query object for reminders the user wants to cancel.',
                'Cancel examples include: "ยกเลิกงานประชุมพรุ่งนี้", "ลบ reminder วิ่งวันอาทิตย์", "cancel all overdue tasks", "ยกเลิกงานที่ส่งพุธหน้า".',
                'For cancel queries, set titleContains when the user names a task, and use dueFrom/dueTo for date phrases.',
                'For cancel queries, includeFinished should usually be false because completed/cancelled reminders do not need cancelling.',
                `Current time: ${now}`,
                `Timezone: ${timezone}`,
                `Message: ${text}`,
              ].join('\n'),
            },
          ],
        },
      ],
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          required: ['intent'],
          properties: {
            intent: {
              type: Type.STRING,
              description: 'create_reminders, list_reminders, cancel_reminders, or unknown.',
            },
            reminders: {
              type: Type.ARRAY,
              nullable: true,
              description: 'Only for create_reminders.',
              items: {
                type: Type.OBJECT,
                required: ['title', 'dueAt', 'timezone'],
                properties: {
                  title: {
                    type: Type.STRING,
                    description: 'Short reminder title, without date/time words unless they are part of the task.',
                  },
                  dueAt: {
                    type: Type.STRING,
                    description: 'ISO 8601 date-time string for when to notify.',
                  },
                  timezone: {
                    type: Type.STRING,
                    description: 'IANA timezone used to resolve the reminder.',
                  },
                  recurrence: {
                    type: Type.OBJECT,
                    nullable: true,
                    description: 'Use only for recurring reminders like every Sunday or every day.',
                    properties: {
                      frequency: {
                        type: Type.STRING,
                        description: 'daily or weekly.',
                      },
                      interval: {
                        type: Type.NUMBER,
                        description: 'Repeat interval. Use 1 for every day or every week.',
                      },
                      daysOfWeek: {
                        type: Type.ARRAY,
                        nullable: true,
                        description: 'For weekly recurrence only. Sunday is 0 and Saturday is 6.',
                        items: {
                          type: Type.NUMBER,
                        },
                      },
                    },
                  },
                },
              },
            },
            query: {
              type: Type.OBJECT,
              nullable: true,
              description: 'Only for list_reminders.',
              properties: {
                title: {
                  type: Type.STRING,
                  description: 'Short Thai heading for the list reply.',
                },
                dueFrom: {
                  type: Type.STRING,
                  nullable: true,
                  description: 'Optional ISO 8601 inclusive date-time lower bound.',
                },
                dueTo: {
                  type: Type.STRING,
                  nullable: true,
                  description: 'Optional ISO 8601 inclusive date-time upper bound.',
                },
                recurrence: {
                  type: Type.STRING,
                  description: 'all, recurring, or non-recurring.',
                },
                includeFinished: {
                  type: Type.BOOLEAN,
                  description: 'Default false. True only if user asks to include finished/all statuses.',
                },
                overdueOnly: {
                  type: Type.BOOLEAN,
                  description: 'True for overdue/late/past-due queries.',
                },
                titleContains: {
                  type: Type.STRING,
                  nullable: true,
                  description: 'Optional task title search text for cancel/list queries.',
                },
              },
            },
            message: {
              type: Type.STRING,
              nullable: true,
              description: 'Only for unknown intent.',
            },
          },
        },
      },
    });

    const parsed = JSON.parse(response.text ?? '{}') as Partial<BotIntent> & { message?: string };
    if (parsed.intent === 'list_reminders' || parsed.intent === 'cancel_reminders') {
      return {
        intent: parsed.intent,
        query: this.normalizeQuery(parsed.query, timezone),
      };
    }

    if (parsed.intent !== 'create_reminders') {
      return {
        intent: 'unknown',
        message: parsed.message || 'ยังไม่เข้าใจว่าให้บันทึกหรือให้ดูรายการไหน',
      };
    }

    const reminders = parsed.reminders ?? [];
    const validReminders: ParsedReminder[] = reminders
      .map((reminder): ParsedReminder => ({
        title: reminder.title?.trim(),
        dueAt: reminder.dueAt,
        timezone: reminder.timezone || timezone,
        recurrence: this.normalizeRecurrence(reminder.recurrence),
      }))
      .filter(
        (reminder) =>
          Boolean(reminder.title) &&
          Boolean(reminder.dueAt) &&
          !Number.isNaN(new Date(reminder.dueAt).getTime()),
      )
      .map((reminder) => ({
        title: reminder.title,
        dueAt: new Date(reminder.dueAt).toISOString(),
        timezone: reminder.timezone,
        recurrence: reminder.recurrence,
      }));

    if (validReminders.length === 0) {
      return {
        intent: 'unknown',
        message: 'ยังไม่เจอวัน เวลา หรือเรื่องที่ต้องเตือน',
      };
    }

    return {
      intent: 'create_reminders',
      reminders: validReminders,
    };
  }

  private normalizeRecurrence(recurrence: ParsedReminder['recurrence']) {
    if (!recurrence || !['daily', 'weekly'].includes(recurrence.frequency)) {
      return undefined;
    }

    const interval = Number.isFinite(recurrence.interval) && recurrence.interval > 0 ? recurrence.interval : 1;
    const daysOfWeek = recurrence.daysOfWeek
      ?.map((day) => Number(day))
      .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6);

    return {
      frequency: recurrence.frequency,
      interval,
      daysOfWeek: recurrence.frequency === 'weekly' && daysOfWeek?.length ? [...new Set(daysOfWeek)].sort() : undefined,
    };
  }

  private normalizeQuery(query: Partial<ReminderQuery> | undefined, timezone: string): ReminderQuery {
    const recurrence: ReminderQuery['recurrence'] = ['recurring', 'non-recurring'].includes(query?.recurrence ?? '')
      ? (query!.recurrence as ReminderQuery['recurrence'])
      : 'all';
    const dueFrom = query?.dueFrom && !Number.isNaN(new Date(query.dueFrom).getTime())
      ? new Date(query.dueFrom).toISOString()
      : undefined;
    const dueTo = query?.dueTo && !Number.isNaN(new Date(query.dueTo).getTime())
      ? new Date(query.dueTo).toISOString()
      : undefined;

    return {
      title: query?.title?.trim() || 'รายการเตือน',
      dueFrom,
      dueTo,
      recurrence,
      includeFinished: query?.includeFinished === true,
      overdueOnly: query?.overdueOnly === true,
      titleContains: query?.titleContains?.trim() || undefined,
    };
  }
}
