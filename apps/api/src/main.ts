import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module.js';
import { loadConfig } from './config.js';

async function bootstrap(): Promise<void> {
  const config = loadConfig();

  const app = await NestFactory.create(AppModule);

  app.setGlobalPrefix('api/v1');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.enableCors({
    origin: config.NODE_ENV === 'development' ? '*' : false,
  });

  await app.listen(config.PORT);
  console.log(`MeshOS API listening on port ${config.PORT}`);
}

bootstrap().catch((err: unknown) => {
  console.error('Failed to start MeshOS API:', err);
  process.exit(1);
});
