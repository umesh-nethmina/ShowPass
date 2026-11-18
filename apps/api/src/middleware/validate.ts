import type { NextFunction, Request, Response } from 'express';
import type { ZodTypeAny, z } from 'zod';
import { badRequest } from '../lib/errors.js';

type Part = 'body' | 'query' | 'params';

/** Validates and replaces req[part] with the parsed value. */
export function validate<T extends ZodTypeAny>(schema: T, part: Part = 'body') {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse(req[part]);
    if (!result.success) {
      return next(badRequest('VALIDATION_ERROR', 'Some fields are invalid', result.error.flatten()));
    }
    if (part === 'query') {
      // req.query is a getter in some setups; store parsed copy separately
      (req as Request & { q: unknown }).q = result.data;
    } else {
      req[part] = result.data;
    }
    next();
  };
}

export const getQuery = <T extends ZodTypeAny>(req: Request, _schema: T) => (req as Request & { q: z.infer<T> }).q;
