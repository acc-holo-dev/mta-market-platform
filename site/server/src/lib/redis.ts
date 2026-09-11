// Redis client for MTA Market (rate limiting, sessions)
import Redis from "ioredis";
import { logger } from "./logger";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

export const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: parseInt(process.env.REDIS_MAX_RETRIES_PER_REQUEST || "3", 10),
  connectTimeout: parseInt(process.env.REDIS_CONNECT_TIMEOUT || "10000", 10),
  // When false, commands reject immediately while disconnected instead of
  // queueing (tests set this so the rate limiter fails open instantly).
  enableOfflineQueue: process.env.REDIS_ENABLE_OFFLINE_QUEUE !== "false",
  retryStrategy(times) {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
});

redis.on("error", (err) => {
  logger.error("redis_connection_error", { error: err });
});

redis.on("connect", () => {
  logger.info("redis_connected");
});