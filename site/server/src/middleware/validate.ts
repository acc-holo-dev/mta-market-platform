// Validation middleware using Zod
// Automatically validates req.body/query/params and returns 400 on failure.
import { Request, Response, NextFunction } from "express";
import { z, ZodError } from "zod";

export type ValidationTarget = "body" | "query" | "params";

/**
 * Express middleware that validates request data with a Zod schema.
 * Returns 400 with validation errors if validation fails.
 */
export function validate<T extends z.ZodTypeAny>(schema: T, target: ValidationTarget = "body") {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const data = req[target];
      req[target] = schema.parse(data);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({
          error: "Validation failed",
          details: error.issues.map((e) => ({
            path: e.path.join("."),
            message: e.message,
          })),
        });
      } else {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  };
}

/**
 * Validate route params (e.g., :id, :slug) with runtime parseInt check.
 * Returns 400 if param is missing or invalid.
 */
export function validateParam(paramName: string, type: "int" | "slug" = "int") {
  return (req: Request, res: Response, next: NextFunction): void => {
    const value = req.params[paramName];

    if (!value || Array.isArray(value)) {
      res.status(400).json({ error: `Missing required parameter: ${paramName}` });
      return;
    }

    if (type === "int") {
      const parsed = parseInt(value, 10);
      if (Number.isNaN(parsed) || parsed <= 0) {
        res.status(400).json({ error: `Invalid ${paramName}: must be a positive integer` });
        return;
      }
      // Attach parsed value for type safety
      (req as any).validatedParams = { ...(req as any).validatedParams, [paramName]: parsed };
    } else if (type === "slug") {
      if (!/^[a-z0-9-]+$/.test(value)) {
        res.status(400).json({ error: `Invalid ${paramName}: must be a valid slug` });
        return;
      }
    }

    next();
  };
}
