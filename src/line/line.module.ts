import { Module } from '@nestjs/common';
import { GeminiReminderParser } from '../reminders/gemini-reminder.parser';
import { ReminderStore } from '../reminders/reminder.store';
import { LineController } from './line.controller';
import { LineService } from './line.service';

@Module({
  controllers: [LineController],
  providers: [GeminiReminderParser, LineService, ReminderStore],
})
export class LineModule {}
