import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, decryptSecret, encryptSecret, totp, verifyTotp } from './totp';

describe('totp', () => {
  // RFC 6238 appendix B, SHA-1 secret "12345678901234567890".
  const secret = base32Encode(Buffer.from('12345678901234567890'));

  it('matches the RFC 6238 test vectors (last 6 digits)', () => {
    expect(totp(secret, 59_000)).toBe('287082');
    expect(totp(secret, 1_111_111_109_000)).toBe('081804');
    expect(totp(secret, 1_234_567_890_000)).toBe('005924');
  });

  it('round-trips base32 and accepts one step of drift', () => {
    expect(base32Decode(secret).toString()).toBe('12345678901234567890');
    const now = 1_700_000_000_000;
    expect(verifyTotp(secret, totp(secret, now - 30_000), now)).toBe(true);
    expect(verifyTotp(secret, totp(secret, now - 90_000), now)).toBe(false);
  });

  it('encrypts secrets at rest', () => {
    const stored = encryptSecret(secret);
    expect(stored).not.toContain(secret);
    expect(decryptSecret(stored)).toBe(secret);
  });
});
