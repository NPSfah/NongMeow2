import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { ReminderQuery, ReminderRecord, ReminderStatus } from './reminder.types';

@Injectable()
export class ReminderStore implements OnModuleInit {
  private readonly logger = new Logger(ReminderStore.name);
  private readonly filePath = join(process.cwd(), 'data', 'reminders.json');
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private records: ReminderRecord[] = [];
  private onDue?: (record: ReminderRecord) => Promise<void>;

  async onModuleInit() {
    await this.load();
    this.records
      .filter((record) => record.status === 'pending')
      .forEach((record) => this.schedule(record));
  }

  setDueHandler(handler: (record: ReminderRecord) => Promise<void>) {
    this.onDue = handler;
  }

  async create(record: ReminderRecord) {
    this.records.push(record);
    await this.save();
    this.schedule(record);
    return record;
  }

  async updateStatus(id: string, status: ReminderStatus) {
    const record = this.records.find((item) => item.id === id);
    if (!record) {
      return undefined;
    }

    record.status = status;
    record.updatedAt = new Date().toISOString();
    this.clearTimer(id);
    await this.save();
    return record;
  }

  async list() {
    return [...this.records];
  }

  async queryByTarget(targetId: string, query: ReminderQuery) {
    const now = Date.now();

    return this.records
      .filter((record) => record.targetId === targetId && this.matchesQuery(record, query, now))
      .sort((left, right) => new Date(left.dueAt).getTime() - new Date(right.dueAt).getTime());
  }

  async getById(targetId: string, id: string) {
    return this.records.find((record) => record.targetId === targetId && record.id === id);
  }

  private async load() {
    try {
      const content = await readFile(this.filePath, 'utf8');
      this.records = JSON.parse(content) as ReminderRecord[];
    } catch {
      this.records = [];
      await this.save();
    }
  }

  private async save() {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(this.records, null, 2));
  }

  private schedule(record: ReminderRecord) {
    this.clearTimer(record.id);

    const dueMs = new Date(record.dueAt).getTime() - Date.now();
    if (dueMs <= 0) {
      void this.fire(record.id);
      return;
    }

    const maxDelayMs = 2_147_483_647;
    const delayMs = Math.min(dueMs, maxDelayMs);
    const timer = setTimeout(() => {
      void this.fire(record.id);
    }, delayMs);
    this.timers.set(record.id, timer);
  }

  private async fire(id: string) {
    const record = this.records.find((item) => item.id === id);
    if (!record || record.status !== 'pending') {
      return;
    }

    const dueMs = new Date(record.dueAt).getTime() - Date.now();
    if (dueMs > 0) {
      this.schedule(record);
      return;
    }

    try {
      await this.onDue?.(record);
      if (record.recurrence) {
        this.advanceRecurring(record);
        await this.save();
        this.schedule(record);
      } else {
        await this.updateStatus(id, 'sent');
      }
    } catch (error) {
      this.logger.error(`Failed to send reminder ${id}`, error);
      this.schedule(record);
    }
  }

  private clearTimer(id: string) {
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
  }

  private matchesQuery(record: ReminderRecord, query: ReminderQuery, now: number) {
    if (!query.includeFinished && record.status !== 'pending') {
      return false;
    }

    if (query.recurrence === 'recurring') {
      if (!record.recurrence) {
        return false;
      }
    }

    if (query.recurrence === 'non-recurring') {
      if (record.recurrence) {
        return false;
      }
    }

    const dueAt = new Date(record.dueAt).getTime();

    if (query.overdueOnly && dueAt >= now) {
      return false;
    }

    if (query.dueFrom && dueAt < new Date(query.dueFrom).getTime()) {
      return false;
    }

    if (query.dueTo && dueAt > new Date(query.dueTo).getTime()) {
      return false;
    }

    if (query.titleContains && !record.title.toLowerCase().includes(query.titleContains.toLowerCase())) {
      return false;
    }

    return true;
  }

  private advanceRecurring(record: ReminderRecord) {
    record.lastSentAt = new Date().toISOString();
    record.dueAt = this.getNextDueAt(record);
    record.updatedAt = new Date().toISOString();
  }

  private getNextDueAt(record: ReminderRecord) {
    if (!record.recurrence) {
      return record.dueAt;
    }

    const due = new Date(record.dueAt);

    if (record.recurrence.frequency === 'daily') {
      due.setDate(due.getDate() + record.recurrence.interval);
      return due.toISOString();
    }

    const daysOfWeek = record.recurrence.daysOfWeek;
    if (!daysOfWeek?.length) {
      due.setDate(due.getDate() + 7 * record.recurrence.interval);
      return due.toISOString();
    }

    const currentDay = due.getDay();
    const dayOffsets = daysOfWeek
      .map((day) => {
        const offset = (day - currentDay + 7) % 7;
        return offset === 0 ? 7 * record.recurrence!.interval : offset;
      })
      .sort((left, right) => left - right);

    due.setDate(due.getDate() + dayOffsets[0]);
    return due.toISOString();
  }
}
