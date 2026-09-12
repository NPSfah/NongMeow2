import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI, Type } from '@google/genai';
import { ParsedReminder } from './reminder.types';

@Injectable()
export class GeminiReminderParser {
  constructor(private readonly config: ConfigService) {}

  async parse(text: string): Promise<ParsedReminder> {
    const apiKey = this.config.get<string>('GEMINI_API_KEY');
    const timezone = this.config.get<string>('APP_TIMEZONE') ?? 'Asia/Bangkok';

    if (!apiKey) {
      throw new Error('GEMINI_API_KEY is not configured');
    }

    const ai = new GoogleGenAI({ apiKey });
    const now = new Date().toISOString();
    const model = this.config.get<string>('GEMINI_MODEL') ?? 'gemini-2.5-flash';

    const response = await ai.models.generateContent({
      model,
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: [
                'Extract a LINE reminder record from this message.',
                'The message may be Thai, English, or mixed.',
                'Return only structured JSON that matches the schema.',
                'If the message is addressed to the bot with a mention, ignore the mention text.',
                'If the user gives a relative date or time, resolve it from the provided current time and timezone.',
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
          },
        },
      },
    });

    const parsed = JSON.parse(response.text ?? '{}') as ParsedReminder;
    if (!parsed.title || !parsed.dueAt || Number.isNaN(new Date(parsed.dueAt).getTime())) {
      throw new Error('Gemini did not return a valid reminder');
    }

    return {
      title: parsed.title.trim(),
      dueAt: new Date(parsed.dueAt).toISOString(),
      timezone: parsed.timezone || timezone,
    };
  }
}
