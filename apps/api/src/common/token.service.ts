import { Injectable } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { AppError } from './app-error';

export type TokenClaims = { sub: string; tid: string };

@Injectable()
export class TokenService {
  sign(claims: TokenClaims): string {
    return jwt.sign(claims, config.jwtSecret, { expiresIn: config.jwtTtlSeconds, algorithm: 'HS256' });
  }

  verify(token: string): TokenClaims {
    try {
      const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
      if (typeof payload === 'string' || typeof payload.sub !== 'string' || typeof payload.tid !== 'string') {
        throw new AppError('UNAUTHENTICATED');
      }
      return { sub: payload.sub, tid: payload.tid };
    } catch {
      throw new AppError('UNAUTHENTICATED');
    }
  }
}
