// Platform configuration surface (PLAN-017 §9/§10).
// Exposes the typed feature flags from config/application/features.yaml so
// the web can hide UI for features that are disabled instead of rendering
// broken placeholders. Read-only, public, cache-friendly.
// PLAN-020 A-003: resolved through lib/featureFlags (60s cache) — the old
// direct loader call re-read and re-validated config/ (3 YAML + JSON schema)
// on every request.
import { Router } from "express";
import { allFeatureFlags } from "../lib/featureFlags.js";

export const configRoutes: Router = Router();

configRoutes.get("/features", (req, res) => {
  const { environment, features } = allFeatureFlags();
  res.json({
    environment,
    features,
  });
});

export default configRoutes;
