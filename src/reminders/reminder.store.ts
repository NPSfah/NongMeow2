import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { Repository } from 'typeorm';
import { ReminderEntity } from './reminder.entity';
import { ReminderEditPatch, ReminderQuery, ReminderRecord, ReminderStatus } from './reminder.types';

@Injectable()
export class ReminderStore implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReminderStore.name);
  private readonly legacyFilePath = join(process.cwd(), 'data', 'reminders.json');
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private onDue?: (record: ReminderRecord) => Promise<void>;

  constructor(
    @InjectRepository(ReminderEntity)
    private readonly reminders: Repository<ReminderEntity>,
  ) {}

  async onModuleInit() {
    await this.migrateLegacyJsonIfNeeded();
    const pending = await this.reminders.find({ where: { status: 'pending' } });
    pending.forEach((record) => this.schedule(this.toRecord(record)));
  }

  onModuleDestroy() {
    for (const id of this.timers.keys()) {
      this.clearTimer(id);
    }
  }

  setDueHandler(handler: (record: ReminderRecord) => Promise<void>) {
    this.onDue = handler;
  }

  async create(record: ReminderRecord) {
    const saved = await this.reminders.save(this.toEntity(record));
    const result = this.toRecord(saved);
    this.schedule(result);
    return result;
  }

  async updateStatus(id: string, status: ReminderStatus) {
    const record = await this.reminders.findOneBy({ id });
    if (!record) {
      return undefined;
    }

    record.status = status;
    record.updatedAt = new Date().toISOString();
    await this.reminders.save(record);
    this.clearTimer(id);
    return this.toRecord(record);
  }

  async updateStatuses(targetId: string, ids: string[], status: ReminderStatus) {
    if (ids.length === 0) {
      return [];
    }

    const records = await this.reminders
      .createQueryBuilder('reminder')
      .where('reminder.targetId = :targetId', { targetId })
      .andWhere('reminder.id IN (:...ids)', { ids })
      .getMany();

    const updatedAt = new Date().toISOString();
    const updated = records.map((record) => {
      record.status = status;
      record.updatedAt = updatedAt;
      this.clearTimer(record.id);
      return record;
    });

    if (updated.length > 0) {
      await this.reminders.save(updated);
    }

    return updated.map((record) => this.toRecord(record));
  }

  async updateReminder(targetId: string, id: string, patch: ReminderEditPatch) {
    const record = await this.reminders.findOneBy({ targetId, id });
    if (!record || record.status !== 'pending') {
      return undefined;
    }

    const originalDueAt = record.dueAt;
    const originalRecurrence = record.recurrence;

    if (patch.title !== undefined) {
      record.title = patch.title;
    }

    if (patch.dueAt !== undefined) {
      record.dueAt = patch.dueAt;
      record.snoozedFromDueAt = null;
    }

    if (patch.timezone !== undefined) {
      record.timezone = patch.timezone;
    }

    if (patch.recurrence !== undefined) {
      record.recurrence = patch.recurrence ?? null;
    }

    record.updatedAt = new Date().toISOString();
    const saved = await this.reminders.save(record);
    const result = this.toRecord(saved);

    if (originalDueAt !== result.dueAt || JSON.stringify(originalRecurrence) !== JSON.stringify(result.recurrence)) {
      this.schedule(result);
    }

    return result;
  }

  async snooze(targetId: string, id: string, minutes: number) {
    const record = await this.reminders.findOneBy({ targetId, id });
    if (!record) {
      return undefined;
    }

    record.status = 'pending';
    record.snoozedFromDueAt = record.recurrence ? record.dueAt : null;
    record.dueAt = new Date(Date.now() + minutes * 60 * 1000).toISOString();
    record.updatedAt = new Date().toISOString();
    const saved = await this.reminders.save(record);
    const result = this.toRecord(saved);
    this.schedule(result);
    return result;
  }

  async list() {
    const records = await this.reminders.find();
    return records.map((record) => this.toRecord(record));
  }

  async queryByTarget(targetId: string, query: ReminderQuery) {
    const now = Date.now();
    const records = await this.reminders.find({ where: { targetId } });

    return records
      .map((record) => this.toRecord(record))
      .filter((record) => this.matchesQuery(record, query, now))
      .sort((left, right) => new Date(left.dueAt).getTime() - new Date(right.dueAt).getTime());
  }

  async getById(targetId: string, id: string) {
    const record = await this.reminders.findOneBy({ targetId, id });
    return record ? this.toRecord(record) : undefined;
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
    const entity = await this.reminders.findOneBy({ id });
    const record = entity ? this.toRecord(entity) : undefined;
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
        const nextRecord = this.advanceRecurring(record);
        await this.reminders.save(this.toEntity(nextRecord));
        this.schedule(nextRecord);
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
    const baseRecord = record.snoozedFromDueAt
      ? {
          ...record,
          dueAt: record.snoozedFromDueAt,
        }
      : record;

    return {
      ...record,
      lastSentAt: new Date().toISOString(),
      snoozedFromDueAt: undefined,
      dueAt: this.getNextDueAt(baseRecord),
      updatedAt: new Date().toISOString(),
    };
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

  private async migrateLegacyJsonIfNeeded() {
    if ((await this.reminders.count()) > 0) {
      return;
    }

    try {
      const content = await readFile(this.legacyFilePath, 'utf8');
      const records = JSON.parse(content) as ReminderRecord[];
      if (!records.length) {
        return;
      }

      await this.reminders.save(records.map((record) => this.toEntity(record)));
      this.logger.log(`Migrated ${records.length} reminder(s) from data/reminders.json to SQLite`);
    } catch {
      this.logger.log('No legacy reminder JSON found to migrate');
    }
  }

  private toRecord(entity: ReminderEntity): ReminderRecord {
    return {
      id: entity.id,
      sourceType: entity.sourceType,
      targetId: entity.targetId,
      createdByUserId: entity.createdByUserId,
      rawText: entity.rawText,
      title: entity.title,
      dueAt: entity.dueAt,
      timezone: entity.timezone,
      recurrence: entity.recurrence ?? undefined,
      lastSentAt: entity.lastSentAt,
      snoozedFromDueAt: entity.snoozedFromDueAt ?? undefined,
      status: entity.status,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }

  private toEntity(record: ReminderRecord): ReminderEntity {
    return this.reminders.create({
      ...record,
      recurrence: record.recurrence ?? null,
      snoozedFromDueAt: record.snoozedFromDueAt ?? null,
    });
  }
}
