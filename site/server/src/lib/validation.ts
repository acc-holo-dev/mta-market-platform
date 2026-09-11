// Zod validation schemas for API inputs
// Protects against malformed/malicious input (P0-04).
import { z } from "zod";

// Common schemas
export const positiveInt = z.number().int().positive();
export const nonNegativeInt = z.number().int().min(0);
export const slug = z.string().regex(/^[a-z0-9-]+$/, "Invalid slug format");
export const cuid = z.string().cuid();
export const email = z.string().email();
export const url = z.string().url();

// Resource creation/update
// NOTE: type enum mirrors the contract ResourceType (SCRIPT/MAP/MODEL/...)
// — the previous values (SCRIPTS/MAPS/...) failed the DB CHECK constraint.
export const createResourceSchema = z.object({
  title: z.string().min(3).max(100),
  slug: slug.max(60),
  description: z.string().min(10).max(5000),
  price: nonNegativeInt.max(100000000), // 0 = free resource, max 1M RUB
  type: z.enum(["SCRIPT", "MAP", "MODEL", "TEXTURE", "SOUND", "GAMEMODE"]),
  tags: z.array(z.string().max(30)).max(10).optional(),
});

export const updateResourceSchema = createResourceSchema.partial();

// Resource version upload
export const createVersionSchema = z.object({
  resourceId: positiveInt,
  version: z.string().regex(/^\d+\.\d+\.\d+$/, "Version must be semver (e.g. 1.0.0)"),
  changelog: z.string().min(1).max(10000),
});

// Purchase creation
export const createPurchaseSchema = z.object({
  resourceSlug: slug,
  discountCode: z.string().min(1).max(50).optional(), // Optional promo code
});

// Review creation
export const createReviewSchema = z.object({
  resourceId: positiveInt,
  rating: z.number().int().min(1).max(5),
  comment: z.string().min(10).max(2000).optional(),
});

// DRM activation
export const activateLicenseSchema = z.object({
  licenseKey: z.string().length(64, "License key must be 64 characters"),
  serverSerial: z.string().min(16).max(128),
});

// Admin moderation
export const moderateResourceSchema = z.object({
  status: z.enum(["PUBLISHED", "REJECTED"]),
  moderationNote: z.string().max(1000).optional(),
});

export const moderateReviewSchema = z.object({
  visible: z.boolean(),
  moderationNote: z.string().max(500).optional(),
});

// Pagination
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// Query filters (PLAN-003 T/U: единый resources query contract).
// type — реальные domain types (G-001/H-002); price — free|paid (H-001);
// sort — реально реализованные стратегии (I-001..I-004).
export const resourceFiltersSchema = z.object({
  q: z.string().max(100).optional(),
  type: z.enum(["SCRIPT", "MAP", "MODEL", "TEXTURE", "SOUND", "GAMEMODE"]).optional(),
  price: z.enum(["free", "paid"]).optional(),
  sort: z.enum(["newest", "rating", "price_asc", "price_desc", "popular"]).optional(),
});
