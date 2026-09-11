// PLAN B-007: Request ID / tracing middleware.
// Every HTTP request gets a request_id that:
// - is returned to the client in the X-Request-Id response header;
// - is bound into every log line emitted for the request (req.log);
// - can be propagated from an upstream caller via the X-Request-Id header.
import { randomUUID } from "crypto";
import { Request, Response, NextFunction } from "express";
import { logger, type Logger } from "../lib/logger";

export interface RequestWithTracing extends Request {
  id?: string;
  log?: Logger;
}

const REQUEST_ID_HEADER = "x-request-id";
const REQUEST_ID_RE = /^[a-zA-Z0-9._-]{8,64}$/;

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.headers[REQUEST_ID_HEADER];
  const incomingId = Array.isArray(incoming) ? incoming[0] : incoming;
  const id =
    incomingId && REQUEST_ID_RE.test(incomingId) ? incomingId : randomUUID();

  (req as RequestWithTracing).id = id;
  res.setHeader("X-Request-Id", id);

  const start = Date.now();
  const log = logger.child({ request_id: id });
  (req as RequestWithTracing).log = log;

  res.on("finish", () => {
    // Access log: one structured line per request (O-001 groundwork).
    log.info("http_request", {
      route: req.originalUrl?.split("?")[0],
      method: req.method,
      status: res.statusCode,
      duration_ms: Date.now() - start,
      user_id: (req as any).user?.userId,
    });
  });

  next();
}

/** Request-scoped logger (falls back to the root logger outside requests). */
export function reqLog(req: Request): Logger {
  return (req as RequestWithTracing).log ?? logger;
}