import { Injectable } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { AppError } from './app-error';

export type TokenClaims = { sub: string; tid: string };
/** Platform console sessions carry no tenant and are accepted only by @PlatformRoute() handlers. */
const PLATFORM_SCOPE = 'platform';

@Injectable()
export class TokenService {
  sign(claims: TokenClaims): string {
    return jwt.sign(claims, config.jwtSecret, { expiresIn: config.jwtTtlSeconds, algorithm: 'HS256' });
  }

  signPlatform(userId: string): string {
    return jwt.sign({ sub: userId, scp: PLATFORM_SCOPE }, config.jwtSecret, { expiresIn: config.jwtTtlSeconds, algorithm: 'HS256' });
  }

  verify(token: string): TokenClaims {
    const payload = this.decode(token);
    if (typeof payload.tid !== 'string') throw new AppError('UNAUTHENTICATED');
    return { sub: payload.sub, tid: payload.tid };
  }

  /** Returns the user id of a platform console token. */
  verifyPlatform(token: string): string {
    const payload = this.decode(token);
    if (payload.scp !== PLATFORM_SCOPE) throw new AppError('UNAUTHENTICATED');
    return payload.sub;
  }

  private decode(token: string): jwt.JwtPayload & { sub: string } {
    try {
      const payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
      if (typeof payload === 'string' || typeof payload.sub !== 'string') throw new AppError('UNAUTHENTICATED');
      return payload as jwt.JwtPayload & { sub: string };
    } catch {
      throw new AppError('UNAUTHENTICATED');
    }
  }
}
