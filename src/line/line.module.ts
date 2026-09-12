import { Module } from '@nestjs/common';
import { GeminiReminderParser } from '../reminders/gemini-reminder.parser';
import { ReminderStore } from '../reminders/reminder.store';
import { LineController } from './line.controller';
import { LineFlexMessageFactory } from './line-flex-message.factory';
import { LineService } from './line.service';

@Module({
  controllers: [LineController],
  providers: [GeminiReminderParser, LineFlexMessageFactory, LineService, ReminderStore],
})
export class LineModule {}
