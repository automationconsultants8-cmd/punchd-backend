import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';
import * as express from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
  });

  // Parse JSON for all routes EXCEPT webhook
  app.use((req, res, next) => {
    if (req.originalUrl === '/api/billing/webhook') {
      next();
    } else {
      express.json({ limit: '50mb' })(req, res, next);
    }
  });

  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  app.enableCors({
    origin: [
      'http://localhost:3001',
      'http://localhost:19006',
      'http://localhost:5173',
      'https://app.gopunchd.com',
      'https://gopunchd.com'
      'https://portal.gopunchd.com'
    ],
    credentials: true,
  });

  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('Time & Attendance Platform API')
    .setDescription('Labor intelligence and workforce control platform')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT || 3000;
  await app.listen(port, '0.0.0.0');

  console.log(`🚀 Time & Attendance Platform API is running!`);
  console.log(`📚 API Docs: http://localhost:${port}/api/docs`);
}
bootstrap();
