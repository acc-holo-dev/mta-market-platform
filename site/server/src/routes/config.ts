// Platform configuration surface (PLAN-017 §9/§10).
// Exposes the typed feature flags from config/application/features.yaml so
// the web can hide UI for features that are disabled instead of rendering
// broken placeholders. Read-only, public, cache-friendly.
import { Router } from "express";
import { featureFlags } from "../config/loader.js";
import { reqLog } from "../middleware/requestId.js";

export const configRoutes: Router = Router();

configRoutes.get("/features", (req, res) => {
  const environment = process.env.NODE_ENV === "production" ? "production" : "development";
  const { flags, issues } = featureFlags(environment);
  if (issues.length) {
    reqLog(req).warn("config_features_degraded", { issues });
  }
  res.json({
    environment,
    features: flags,
  });
});

export default configRoutes;
