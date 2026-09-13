import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GeminiReminderParser } from '../reminders/gemini-reminder.parser';
import { LocalCommandParser } from '../reminders/local-command.parser';
import { ReminderEntity } from '../reminders/reminder.entity';
import { ReminderStore } from '../reminders/reminder.store';
import { LineController } from './line.controller';
import { LineFlexMessageFactory } from './line-flex-message.factory';
import { LineService } from './line.service';

@Module({
  imports: [TypeOrmModule.forFeature([ReminderEntity])],
  controllers: [LineController],
  providers: [GeminiReminderParser, LocalCommandParser, LineFlexMessageFactory, LineService, ReminderStore],
})
export class LineModule {}
