import type { ErrorCode, ErrorParams } from '@erp/shared';

const STATUS_BY_CODE: Partial<Record<ErrorCode, number>> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  INVALID_CREDENTIALS: 401,
  MFA_REQUIRED: 401,
  MFA_INVALID: 401,
  RATE_LIMITED: 429,
  FORBIDDEN: 403,
  OUT_OF_SCOPE: 403,
  SIGNUP_DISABLED: 403,
  FEATURE_NOT_IN_PLAN: 403,
  PASSWORD_CHANGE_REQUIRED: 403,
  CURRENT_PASSWORD_INVALID: 400,
  PASSWORD_RESET_INVALID: 400,
  PASSWORD_RESET_UNAVAILABLE: 503,
  USER_IN_OTHER_TENANTS: 409,
  PLAN_IN_USE: 409,
  PLATFORM_ADMIN_ACCOUNT: 409,
  NOT_FOUND: 404,
  EMAIL_TAKEN: 409,
  DUPLICATE_CODE: 409,
  CONCURRENT_MODIFICATION: 409,
  INTERNAL: 500,
};

/** A business-rule failure carrying a translatable code. Defaults to HTTP 422. */
export class AppError extends Error {
  readonly status: number;

  constructor(
    readonly code: ErrorCode,
    readonly params: ErrorParams = {},
    readonly issues?: { path: string; message: string }[],
  ) {
    super(code);
    this.status = STATUS_BY_CODE[code] ?? 422;
  }
}

export const notFound = (entity: string): AppError => new AppError('NOT_FOUND', { entity });
