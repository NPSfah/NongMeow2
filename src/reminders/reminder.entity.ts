import { Column, Entity, PrimaryColumn } from 'typeorm';
import type { ReminderRecurrence, ReminderSourceType, ReminderStatus } from './reminder.types';

@Entity({ name: 'reminders' })
export class ReminderEntity {
  @PrimaryColumn()
  id: string;

  @Column()
  sourceType: ReminderSourceType;

  @Column()
  targetId: string;

  @Column({ type: 'text', nullable: true })
  createdByUserId?: string;

  @Column()
  rawText: string;

  @Column()
  title: string;

  @Column()
  dueAt: string;

  @Column()
  timezone: string;

  @Column({ type: 'simple-json', nullable: true })
  recurrence?: ReminderRecurrence | null;

  @Column({ type: 'text', nullable: true })
  lastSentAt?: string;

  @Column({ type: 'text', nullable: true })
  snoozedFromDueAt?: string | null;

  @Column()
  status: ReminderStatus;

  @Column()
  createdAt: string;

  @Column()
  updatedAt: string;
}
