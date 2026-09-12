// DRM v1 routes — DEPRECATED activation protocol (PLAN TASK A-007, ADR-001).
//
// Decision: option A — v1 activation protocol is deprecated and blocked.
// - POST /drm/activate and POST /drm/verify return 410 Gone.
//   Reasons: fake keypairs (crypto.randomBytes as "keys"), private key
//   returned to the client over HTTP, private key used as a bearer secret,
//   and incompatibility with the current contract schema (no privateKey
//   field on Installation). DRM v2 (/drm/v2/*) is the only activation protocol.
// - PLAN-020 A-004.01/T-001: the legacy license MANAGEMENT endpoints
//   (GET /drm/my-licenses, DELETE /drm/revoke/:licenseId) were removed —
//   zero consumers (web reads /purchases/my; the module speaks /drm/v2),
//   N+1 loops, and revocation that bypassed lib/drm/service.ts (no audit).
//   Canonical revocation: lib/drm/service.ts revokeInstallation via /drm/v2.
import { Router, Response } from "express";

const router: Router = Router();

// POST /drm/activate - BLOCKED (deprecated v1 activation protocol)
router.post("/activate", (_req, res: Response) => {
  res.status(410).json({
    error: "DRM v1 activation protocol is deprecated and blocked",
    message: "Use the DRM v2 protocol (/drm/v2/*). See ADR-001 in mta-market-document.",
    protocol: "v1",
    status: "deprecated",
  });
});

// POST /drm/verify - BLOCKED (deprecated v1 activation protocol)
router.post("/verify", (_req, res: Response) => {
  res.status(410).json({
    error: "DRM v1 verification protocol is deprecated and blocked",
    message: "Use the DRM v2 protocol (/drm/v2/installations/:id/verify). See ADR-001.",
    protocol: "v1",
    status: "deprecated",
  });
});

export default router;