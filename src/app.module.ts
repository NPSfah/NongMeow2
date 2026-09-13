import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { mkdir } from 'fs/promises';
import { dirname } from 'path';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { LineModule } from './line/line.module';
import { ReminderEntity } from './reminders/reminder.entity';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      useFactory: async () => {
        const database = process.env.DATABASE_PATH ?? 'data/reminders.sqlite';
        await mkdir(dirname(database), { recursive: true });

        return {
          type: 'sqlite',
          database,
          entities: [ReminderEntity],
          synchronize: true,
        };
      },
    }),
    LineModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
