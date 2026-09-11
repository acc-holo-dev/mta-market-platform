// NAMING DEBT (documented in mta-market-document status.md): ids are UUID v4
// (schema @default(uuid())), the middleware name is historical. New code
// should import { validateUuid } — the same implementation.
// Domain ID validation middleware
// TASK A-004: domain IDs are opaque strings, never numbers.
// The contract generates ids with @default(uuid()) (PSL v1 dialect has no
// cuid()), so the accepted format is UUID v4.
import { Request, Response, NextFunction } from "express";

/**
 * UUID v4 format (36 chars with hyphens)
 * Example: 550e8400-e29b-41d4-a716-446655440000
 */
const DOMAIN_ID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Validates that a route parameter is a valid domain ID (UUID) format
 * @param paramName - Name of the route parameter to validate (e.g., 'id', 'userId', 'resourceId')
 * @returns Express middleware function
 *
 * @example
 * router.get('/users/:id', validateCuid('id'), handler);
 * router.patch('/resources/:resourceId', validateCuid('resourceId'), handler);
 */
export function validateCuid(paramName: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const raw = req.params[paramName];
    const value = Array.isArray(raw) ? raw[0] : raw;

    if (!value) {
      res.status(400).json({
        error: 'Missing parameter',
        message: `Route parameter '${paramName}' is required`,
      });
      return;
    }

    if (!DOMAIN_ID_REGEX.test(value)) {
      res.status(400).json({
        error: 'Invalid ID format',
        message: `Parameter '${paramName}' must be a valid domain ID (UUID)`,
        received: value,
      });
      return;
    }

    next();
  };
}

/**
 * Validates multiple CUID parameters at once
 * @param paramNames - Array of parameter names to validate
 * @returns Express middleware function
 * 
 * @example
 * router.post('/licenses/:licenseId/installations/:installationId', 
 *   validateCuids(['licenseId', 'installationId']), 
 *   handler
 * );
 */
export function validateCuids(paramNames: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    for (const paramName of paramNames) {
      const raw = req.params[paramName];
      const value = Array.isArray(raw) ? raw[0] : raw;

      if (!value) {
        res.status(400).json({
          error: 'Missing parameter',
          message: `Route parameter '${paramName}' is required`,
        });
        return;
      }

      if (!DOMAIN_ID_REGEX.test(value)) {
        res.status(400).json({
          error: 'Invalid ID format',
          message: `Parameter '${paramName}' must be a valid domain ID (UUID)`,
          received: value,
        });
        return;
      }
    }

    next();
  };
}

/**
 * Check if a string is a valid domain ID (UUID) (utility function)
 * @param value - String to validate
 * @returns true if valid UUID format
 */
export function isCuid(value: string): boolean {
  return DOMAIN_ID_REGEX.test(value);
}

// PLAN P-002 finding: ids are UUID v4, not cuid — documented alias.
export const validateUuid = validateCuid;
