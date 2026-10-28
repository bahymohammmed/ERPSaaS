import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { config } from './config';

const bootstrap = async (): Promise<void> => {
  const app = await NestFactory.create(AppModule, { bodyParser: true });
  configureApp(app);
  app.enableShutdownHooks();
  await app.listen(config.port);
  console.log(`ERP API listening on :${config.port}/api`);
};

void bootstrap();
