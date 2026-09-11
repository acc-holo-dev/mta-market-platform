// DRM v1 routes — DEPRECATED activation protocol (PLAN TASK A-007, ADR-001).
//
// Decision: option A — v1 activation protocol is deprecated and blocked.
// - POST /drm/activate and POST /drm/verify return 410 Gone.
//   Reasons: fake keypairs (crypto.randomBytes as "keys"), private key
//   returned to the client over HTTP, private key used as a bearer secret,
//   and incompatibility with the current contract schema (no privateKey
//   field on Installation). DRM v2 (/drm/v2/*) is the only activation protocol.
// - License MANAGEMENT endpoints (my-licenses, revoke) remain active: they
//   are authenticated, ownership-checked and not part of the activation protocol.
import { Router, Response } from "express";
import { authenticate, AuthRequest } from "../lib/auth";
import { standardRateLimit } from "../lib/rateLimit";
import { validateCuid } from "../middleware/validateCuid";
import { db } from "../prisma/db";
import { reqLog } from "../middleware/requestId";

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

// GET /drm/my-licenses - Get user's licenses (authenticated)
router.get(
  "/my-licenses",
  authenticate,
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      // Get all purchases by user
      const purchases = await db.orm.public.Purchase.where({
        buyerId: req.user!.userId,
        status: "COMPLETED",
      }).all();

      // Get licenses for those purchases
      const licenses = [];
      for (const purchase of purchases) {
        const license = await db.orm.public.License.where({ purchaseId: purchase.id }).first();

        if (license) {
          // Get installations
          const installations = await db.orm.public.Installation.where({
            licenseId: license.id,
          }).all();

          licenses.push({
            licenseId: license.id,
            purchaseId: purchase.id,
            resourceId: purchase.resourceId,
            status: license.status,
            serverSerial: license.serverSerial,
            activatedAt: license.activatedAt,
            expiresAt: license.expiresAt,
            installations: installations.map((i) => ({
              serverSerial: i.serverSerial,
              serverName: i.serverName,
              status: i.status,
              installedAt: i.installedAt,
              lastHeartbeat: i.lastHeartbeat,
            })),
          });
        }
      }

      res.json(licenses);
    } catch (error) {
      reqLog(req).error("licenses_fetch_failed", { user_id: req.user!.userId, error });
      res.status(500).json({ error: "Failed to fetch licenses" });
    }
  }
);

// DELETE /drm/revoke/:licenseId - Revoke license (authenticated, owner only)
router.delete(
  "/revoke/:licenseId",
  authenticate,
  validateCuid('licenseId'),
  standardRateLimit,
  async (req: AuthRequest, res: Response) => {
    try {
      const licenseId = req.params.licenseId as string;

      const license = await db.orm.public.License.where({ id: licenseId }).first();

      if (!license) {
        res.status(404).json({ error: "License not found" });
        return;
      }

      // Check ownership
      const purchase = await db.orm.public.Purchase.where({ id: license.purchaseId }).first();

      if (!purchase || purchase.buyerId !== req.user!.userId) {
        res.status(403).json({ error: "Not authorized" });
        return;
      }

      // Revoke license
      await db.orm.public.License.where({ id: licenseId }).update({
        status: "REVOKED",
        revokedAt: new Date().toISOString(),
      });

      // Revoke all installations
      const installations = await db.orm.public.Installation.where({ licenseId }).all();

      for (const installation of installations) {
        await db.orm.public.Installation.where({ id: installation.id }).update({
          status: "REVOKED",
        });
      }

      res.json({ message: "License revoked successfully" });
    } catch (error) {
      reqLog(req).error("license_revoke_failed", { license_id: req.params.licenseId, error });
      res.status(500).json({ error: "Failed to revoke license" });
    }
  }
);

export default router;