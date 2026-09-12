import { NestFactory } from '@nestjs/core';
import express from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.use('/line/webhook', express.raw({ type: 'application/json' }));
  app.use(express.json());
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
