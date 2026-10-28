import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import { config } from './config';

/** Shared HTTP setup for the server and the e2e tests. */
export const configureApp = (app: INestApplication): void => {
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    next();
  });
  app.enableCors({ origin: config.corsOrigin.split(','), credentials: true });
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
};
