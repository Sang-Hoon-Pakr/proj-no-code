import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { setupApp } from './setup-app';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  setupApp(app);
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  Logger.log(`Server listening on :${port}`, 'Bootstrap');
}

void bootstrap();
