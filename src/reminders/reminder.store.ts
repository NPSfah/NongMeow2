import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { ReminderRecord, ReminderStatus } from './reminder.types';

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
      await this.updateStatus(id, 'sent');
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
}
