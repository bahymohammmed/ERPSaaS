import { type PipeTransform } from '@nestjs/common';
import type { ZodType, ZodTypeDef } from 'zod';
import { AppError } from './app-error';

/** Validates and normalises a body/query with a shared zod schema. */
export class ZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T, ZodTypeDef, unknown>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    throw new AppError(
      'VALIDATION_FAILED',
      {},
      result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    );
  }
}

export const parse = <T>(schema: ZodType<T, ZodTypeDef, unknown>, value: unknown): T => new ZodPipe(schema).transform(value);
