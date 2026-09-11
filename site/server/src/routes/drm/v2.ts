/**
 * TASK-020 / PLAN A-006: DRM Protocol v2 Routes
 *
 * Machine-facing protocol mounted at /drm/v2/* (see app.ts).
 *
 * Authorization model:
 * - POST /v2/installations        -> browser-authenticated (license owner);
 * - POST /v2/installations/:id/verify -> machine, proves possession of the
 *   installation private key via challenge signature (strict rate limit);
 * - POST /v2/activate             -> machine, verified installation only;
 * - POST /v2/heartbeat            -> machine, active installation only;
 * - GET  /v2/leases/:installationId/:resourceId -> machine, active lease lookup;
 * - GET  /v2/public-key           -> public (lease signature verification).
 */

import { Router, Request, Response } from 'express';
import {
  registerInstallation,
  verifyInstallation,
  activateLicense,
  recordHeartbeat,
  getServerPublicKey,
  getActiveLease,
  getTrustedServerKeys,
  issueVersionDek
} from '../../lib/drm/service';
import { DRM_ERROR_CODES } from '../../lib/drm/types';
import { authenticate, AuthRequest } from '../../lib/auth';
import { strictRateLimit, standardRateLimit } from '../../lib/rateLimit';
import { reqLog } from '../../middleware/requestId';

const router: Router = Router();

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Map known DRM service errors to HTTP status codes. */
function drmErrorStatus(error: Error): number | null {
  switch (error.message) {
    case DRM_ERROR_CODES.INSTALLATION_NOT_FOUND:
      return 404;
    case DRM_ERROR_CODES.INVALID_LICENSE:
      return 404;
    case DRM_ERROR_CODES.INSTALLATION_NOT_VERIFIED:
      return 403;
    case DRM_ERROR_CODES.INSTALLATION_REVOKED:
      return 403;
    case DRM_ERROR_CODES.LICENSE_NOT_OWNED:
      return 403;
    case DRM_ERROR_CODES.LICENSE_INSTALLATION_MISMATCH:
      return 403;
    case DRM_ERROR_CODES.INVALID_CHALLENGE_RESPONSE:
      return 401;
    case DRM_ERROR_CODES.NONCE_ALREADY_USED:
      return 409;
    case DRM_ERROR_CODES.INVALID_SIGNATURE:
      return 401;
    case DRM_ERROR_CODES.ARTIFACT_HASH_MISMATCH:
      return 404;
    case DRM_ERROR_CODES.INSUFFICIENT_CAPABILITIES:
      return 403;
    default:
      return null;
  }
}

function sendDrmError(res: Response, error: Error, fallbackMessage: string): void {
  const status = drmErrorStatus(error);
  if (status !== null) {
    res.status(status).json({
      error: {
        code: error.message,
        message: error.message.replace(/_/g, ' ').toLowerCase()
      }
    });
    return;
  }
  res.status(500).json({
    error: {
      code: 'SERVER_ERROR',
      message: fallbackMessage
    }
  });
}

/**
 * GET /drm/v2/public-key
 *
 * Get server's public key for lease verification.
 */
router.get('/v2/public-key', async (req: Request, res: Response) => {
  try {
    const publicKey = await getServerPublicKey();

    res.json({
      publicKey,
      algorithm: 'EdDSA',
      keyType: 'ED25519'
    });
  } catch (error) {
    reqLog(req).error("drm_public_key_fetch_failed", { error });
    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to retrieve server public key'
      }
    });
  }
});

/**
 * POST /drm/v2/installations
 *
 * Register new installation with public key. Requires an authenticated user
 * who owns the license being activated (INV-007).
 */
router.post('/v2/installations', authenticate, strictRateLimit, async (req: AuthRequest, res: Response) => {
  try {
    const { publicKey, licenseId, mtaVersion, moduleVersion, serverSerial, serverName } = req.body;

    // Validation
    if (!publicKey || !licenseId || !mtaVersion || !moduleVersion) {
      return res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Missing required fields: publicKey, licenseId, mtaVersion, moduleVersion'
        }
      });
    }

    if (!UUID_REGEX.test(licenseId)) {
      return res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'licenseId must be a valid domain ID (UUID)'
        }
      });
    }

    const result = await registerInstallation(
      {
        publicKey,
        licenseId,
        mtaVersion,
        moduleVersion,
        serverSerial,
        serverName
      },
      req.user!.userId
    );

    res.status(201).json(result);
  } catch (error) {
    reqLog(req).error("drm_installation_registration_failed", { error });

    if (error instanceof Error && error.message.includes('already exists')) {
      return res.status(409).json({
        error: {
          code: 'INSTALLATION_EXISTS',
          message: error.message
        }
      });
    }

    if (error instanceof Error) {
      return sendDrmError(res, error, 'Failed to register installation');
    }

    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to register installation'
      }
    });
  }
});

/**
 * POST /drm/v2/installations/:id/verify
 *
 * Verify installation with challenge response (possession of private key).
 */
router.post('/v2/installations/:id/verify', strictRateLimit, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { challengeResponse } = req.body;

    if (!challengeResponse) {
      return res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Missing challengeResponse'
        }
      });
    }

    const result = await verifyInstallation({
      installationId: id as string,
      challengeResponse
    });

    res.json(result);
  } catch (error) {
    reqLog(req).error("drm_installation_verification_failed", { error });

    if (error instanceof Error) {
      if (error.message === 'Installation already verified' || error.message.includes('No challenge')) {
        return res.status(409).json({
          error: {
            code: 'INSTALLATION_ALREADY_VERIFIED',
            message: error.message
          }
        });
      }
      return sendDrmError(res, error, 'Failed to verify installation');
    }

    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to verify installation'
      }
    });
  }
});

/**
 * POST /drm/v2/activate
 *
 * Activate license and get signed lease.
 */
router.post('/v2/activate', strictRateLimit, async (req: Request, res: Response) => {
  try {
    const { licenseId, installationId, nonce } = req.body;

    // Validation
    if (!licenseId || !installationId || !nonce) {
      return res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Missing required fields: licenseId, installationId, nonce'
        }
      });
    }

    // Get server private key from environment
    const privateKey = process.env.DRM_SERVER_PRIVATE_KEY;
    if (!privateKey) {
      reqLog(req).error("drm_server_private_key_missing");
      return res.status(500).json({
        error: {
          code: 'SERVER_MISCONFIGURED',
          message: 'Server signing key not configured'
        }
      });
    }

    const lease = await activateLicense(
      { licenseId, installationId, nonce },
      privateKey
    );

    res.json(lease);
  } catch (error) {
    reqLog(req).error("drm_license_activation_failed", { error });

    if (error instanceof Error) {
      if (error.message === 'Invalid nonce format') {
        return res.status(400).json({
          error: {
            code: 'INVALID_NONCE',
            message: 'Invalid nonce format'
          }
        });
      }
      if (error.message.includes('License is ') || error.message.includes('not signed') || error.message.includes('signing key')) {
        return res.status(409).json({
          error: {
            code: 'LICENSE_STATE_ERROR',
            message: error.message
          }
        });
      }
      return sendDrmError(res, error, 'Failed to activate license');
    }

    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to activate license'
      }
    });
  }
});

/**
 * POST /drm/v2/heartbeat
 *
 * Record installation heartbeat.
 */
router.post('/v2/heartbeat', standardRateLimit, async (req: Request, res: Response) => {
  try {
    const { installationId, resourceId, uptime, lastError } = req.body;

    if (!installationId || !resourceId) {
      return res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Missing required fields: installationId, resourceId'
        }
      });
    }

    const result = await recordHeartbeat({
      installationId,
      resourceId,
      uptime: uptime || 0,
      lastError
    });

    res.json(result);
  } catch (error) {
    reqLog(req).error("drm_heartbeat_failed", { error });

    if (error instanceof Error) {
      return sendDrmError(res, error, 'Failed to record heartbeat');
    }

    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to record heartbeat'
      }
    });
  }
});

/**
 * GET /drm/v2/leases/:installationId/:resourceId
 *
 * Get active lease for installation and resource.
 */
router.get('/v2/leases/:installationId/:resourceId', standardRateLimit, async (req: Request, res: Response) => {
  try {
    const { installationId, resourceId } = req.params as { installationId: string; resourceId: string };

    const lease = await getActiveLease(installationId, resourceId);

    if (!lease) {
      return res.status(404).json({
        error: {
          code: 'LEASE_NOT_FOUND',
          message: 'No active lease found'
        }
      });
    }

    res.json(lease);
  } catch (error) {
    reqLog(req).error("drm_lease_fetch_failed", { error });
    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to retrieve lease'
      }
    });
  }
});


/**
 * GET /drm/v2/public-keys
 *
 * PLAN G-007: all trusted server public keys (ACTIVE + PREVIOUS) so modules
 * can verify leases signed before/during a key rotation. Verification picks
 * the key by lease.serverKeyId. REVOKED/EXPIRED keys are never returned.
 */
router.get('/v2/public-keys', async (req: Request, res: Response) => {
  try {
    const keys = await getTrustedServerKeys();
    res.json({
      keys,
      algorithm: 'EdDSA',
      keyType: 'ED25519'
    });
  } catch (error) {
    reqLog(req).error("drm_public_keys_fetch_failed", { error });
    res.status(500).json({
      error: {
        code: 'SERVER_ERROR',
        message: 'Failed to retrieve server public keys'
      }
    });
  }
});

/**
 * POST /drm/v2/versions/:versionId/dek
 *
 * PLAN G-005: release the per-version DEK to an installation that proves
 * possession of its private key and holds a valid lease covering this
 * version. The server master key never leaves the server.
 * Body: { installationId, nonce, signature } — signature (base64 Ed25519)
 * over the ASCII bytes `dek:${versionId}:${nonce}`.
 */
router.post('/v2/versions/:versionId/dek', strictRateLimit, async (req: Request, res: Response) => {
  try {
    const { versionId } = req.params;
    const { installationId, nonce, signature } = req.body ?? {};

    if (!installationId || !nonce || !signature) {
      return res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Missing required fields: installationId, nonce, signature'
        }
      });
    }
    if (typeof versionId !== 'string' || !UUID_REGEX.test(versionId)) {
      return res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'versionId must be a valid domain ID (UUID)'
        }
      });
    }

    const result = await issueVersionDek({ versionId, installationId, nonce, signature });
    res.json(result);
  } catch (error) {
    reqLog(req).warn("drm_version_dek_denied", {
      error: error instanceof Error ? error.message : String(error)
    });

    if (error instanceof Error && error.message === 'Invalid nonce format') {
      return res.status(400).json({
        error: { code: 'INVALID_REQUEST', message: 'Invalid nonce format' }
      });
    }
    if (error instanceof Error && error.message === 'Resource version is not encrypted') {
      return res.status(404).json({
        error: { code: 'NOT_ENCRYPTED', message: 'Resource version is not encrypted' }
      });
    }

    return sendDrmError(res, error as Error, 'Failed to release version DEK');
  }
});

export default router;