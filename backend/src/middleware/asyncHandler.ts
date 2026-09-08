import type { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Express 4 does not await async handlers, so a rejected promise inside one
 * becomes an unhandled rejection instead of reaching error middleware. Wrap
 * every async handler/middleware with this.
 */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}
