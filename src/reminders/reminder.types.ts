export type ReminderStatus = 'pending' | 'completed' | 'cancelled' | 'sent';

export type ReminderSourceType = 'user' | 'group' | 'room';

export interface ReminderRecord {
  id: string;
  sourceType: ReminderSourceType;
  targetId: string;
  createdByUserId?: string;
  rawText: string;
  title: string;
  dueAt: string;
  timezone: string;
  status: ReminderStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ParsedReminder {
  title: string;
  dueAt: string;
  timezone: string;
}
