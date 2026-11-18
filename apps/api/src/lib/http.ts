import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** Wraps an async handler so rejected promises reach the error middleware (Express 4). */
export const h =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };
