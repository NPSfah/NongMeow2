export type ReminderStatus = 'pending' | 'completed' | 'cancelled' | 'sent';

export type ReminderSourceType = 'user' | 'group' | 'room';

export type RecurrenceFrequency = 'daily' | 'weekly';

export interface ReminderRecurrence {
  frequency: RecurrenceFrequency;
  interval: number;
  daysOfWeek?: number[];
}

export interface ReminderRecord {
  id: string;
  sourceType: ReminderSourceType;
  targetId: string;
  createdByUserId?: string;
  rawText: string;
  title: string;
  dueAt: string;
  timezone: string;
  recurrence?: ReminderRecurrence;
  lastSentAt?: string;
  status: ReminderStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ParsedReminder {
  title: string;
  dueAt: string;
  timezone: string;
  recurrence?: ReminderRecurrence;
}

export type ReminderRecurrenceFilter = 'all' | 'recurring' | 'non-recurring';

export interface ReminderQuery {
  title: string;
  dueFrom?: string;
  dueTo?: string;
  recurrence: ReminderRecurrenceFilter;
  includeFinished: boolean;
  overdueOnly: boolean;
  titleContains?: string;
}

export type BotIntent =
  | {
      intent: 'create_reminders';
      reminders: ParsedReminder[];
    }
  | {
      intent: 'list_reminders';
      query: ReminderQuery;
    }
  | {
      intent: 'cancel_reminders';
      query: ReminderQuery;
    }
  | {
      intent: 'unknown';
      message: string;
    };
