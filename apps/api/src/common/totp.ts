import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from '../config';

/** RFC 6238 TOTP (SHA-1, 30-second steps, 6 digits) as used by common authenticator apps. */

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export const base32Encode = (data: Buffer): string => {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
};

export const base32Decode = (text: string): Buffer => {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of text.replace(/=+$/, '').toUpperCase()) {
    const index = BASE32.indexOf(char);
    if (index === -1) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
};

export const generateSecret = (): string => base32Encode(randomBytes(20));

export const totp = (secret: string, time = Date.now(), step = 30): string => {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(time / 1000 / step)));
  const hmac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = (hmac[hmac.length - 1] ?? 0) & 15;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, '0');
};

/** Accepts the current code and one step either side to tolerate clock drift. */
export const verifyTotp = (secret: string, code: string, time = Date.now()): boolean =>
  [-1, 0, 1].some((drift) => {
    const expected = Buffer.from(totp(secret, time + drift * 30_000));
    const given = Buffer.from(code.padStart(6, '0').slice(0, 6));
    return expected.length === given.length && timingSafeEqual(expected, given);
  });

export const otpauthUrl = (secret: string, account: string, issuer = 'ERP'): string =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

// Secrets are stored encrypted with AES-256-GCM under a key derived from MFA_ENCRYPTION_KEY.
const key = (): Buffer => createHash('sha256').update(process.env.MFA_ENCRYPTION_KEY ?? `mfa:${config.jwtSecret}`).digest();

export const encryptSecret = (secret: string): string => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64')).join(':');
};

export const decryptSecret = (stored: string): string => {
  const [iv, tag, data] = stored.split(':').map((p) => Buffer.from(p, 'base64'));
  if (!iv || !tag || !data) throw new Error('Invalid secret');
  const decipher = createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
};
