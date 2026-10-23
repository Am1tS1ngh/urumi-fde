import { BadRequestException } from '@nestjs/common';
import type * as z from 'zod/v4';

export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new BadRequestException(result.error.issues.map(issue => `${issue.path.join('.') || 'body'}: ${issue.message}`));
  }
  return result.data;
}
