// Authentication routes (OAuth2 identity providers + JWT)
// PLAN D-002/D-003/D-004: registry-driven OAuth (Discord, Yandex, Google),
// identity linking/unlinking, oauth_state CSRF cookie.
import { Router, Request, Response } from "express";
import crypto from "crypto";
import { authRateLimit } from "../lib/rateLimit";
import { authenticate, AuthRequest } from "../lib/auth";
import { generateAccessToken, generateRefreshToken, verifyRefreshToken, verifyAccessToken } from "../lib/jwt";
import { hashRefreshToken, generateTokenId, verifyRefreshTokenHash } from "../lib/tokenSecurity";
import { setRefreshCookie, clearRefreshCookie } from "../lib/cookies";
import { db } from "../prisma/db";
import { sendWelcomeEmail } from "../lib/email";
import { userRateLimit } from "../lib/rateLimit";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { reqLog } from "../middleware/requestId";
import { identityProviders } from "../lib/identityProvider";

// Side-effect imports: each provider self-registers into the global registry.
import "../lib/providers/discord";
import "../lib/providers/yandex";
import "../lib/providers/google";

const router: Router = Router();

// Short-lived CSRF/linking cookies for the OAuth round-trip.
const OAUTH_STATE_COOKIE = "oauth_state";
const LINK_USER_COOKIE = "link_user";
const OAUTH_COOKIE_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes

const OAUTH_COOKIE_ATTRS = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: OAUTH_COOKIE_MAX_AGE_MS,
};

function setOAuthCookies(res: Response, state: string): void {
  res.cookie(OAUTH_STATE_COOKIE, state, OAUTH_COOKIE_ATTRS);
}

function clearOAuthCookies(res: Response): void {
  res.clearCookie(OAUTH_STATE_COOKIE, { httpOnly: true, sameSite: "lax", path: "/" });
  res.clearCookie(LINK_USER_COOKIE, { httpOnly: true, sameSite: "lax", path: "/" });
}

function frontendUrl(): string {
  return process.env.FRONTEND_URL || "http://localhost:3000";
}

/** Build a conflict-free username from a provider username. */
async function buildUsername(base: string): Promise<string> {
  const sanitized = base.toLowerCase().replace(/[^a-z0-9_]/g, "") || "user";
  const existing = await db.orm.public.User.where({ username: sanitized }).first();
  if (!existing) return sanitized;
  return `${sanitized}_${crypto.randomBytes(3).toString("hex")}`;
}

/** True when the email looks like a real address, not a synthetic `.local` fallback. */
function isRealEmail(email: string): boolean {
  return !email.endsWith(".local");
}


// ---------------------------------------------------------------------------
// PLAN-001 A-001/A-002: local registration + login (username/email + password).
// Uses the existing session/token/cookie infrastructure — no parallel auth
// system. OAuth-only accounts keep passwordHash = null.
// ---------------------------------------------------------------------------

const PASSWORD_MIN_LENGTH = 8;

const registerSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(30)
    .regex(/^[a-zA-Z0-9_-]+$/, "Username may contain letters, digits, _ and -"),
  email: z.string().email(),
  password: z.string().min(PASSWORD_MIN_LENGTH).max(200),
  confirmPassword: z.string().optional(),
});

const loginSchema = z.object({
  login: z.string().min(1), // username or email
  password: z.string().min(1),
});

/** PLAN-001 C-002: every account starts with balance 0 (persisted row). */
async function ensureUserBalance(userId: string): Promise<void> {
  const existing = await db.orm.public.UserBalance.where({ userId }).first();
  if (!existing) {
    await db.orm.public.UserBalance.create({
      userId,
      available: 0,
      currency: "RUB",
    });
  }
}

/** Shared session issuance: tokens + refresh cookie (same as OAuth flow). */
async function issueSession(
  req: Request,
  res: Response,
  user: { id: string; email: string; role: string }
): Promise<string> {
  const accessToken = generateAccessToken({
    userId: user.id,
    email: user.email,
    role: user.role as "USER" | "ADMIN" | "MODERATOR",
  });
  const refreshToken = generateRefreshToken({
    userId: user.id,
    email: user.email,
    role: user.role as "USER" | "ADMIN" | "MODERATOR",
  });
  await db.orm.public.Session.create({
    userId: user.id,
    refreshTokenHash: hashRefreshToken(refreshToken),
    tokenFamily: generateTokenId(),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    ipAddress: req.ip || req.socket.remoteAddress,
    userAgent: Array.isArray(req.headers["user-agent"])
      ? req.headers["user-agent"][0]
      : req.headers["user-agent"],
  });
  setRefreshCookie(res, refreshToken);
  await ensureUserBalance(user.id);
  return accessToken;
}

function publicUser(user: {
  id: string;
  email: string;
  username: string | null;
  displayName: string | null;
  avatar: string | null;
  role: string;
  status: string;
  createdAt: string;
}): Record<string, unknown> {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    displayName: user.displayName,
    avatar: user.avatar,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt,
  };
}

// POST /auth/register - PLAN-001 A-001
router.post("/register", authRateLimit, async (req: Request, res: Response) => {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      res.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: issue
            ? `${issue.path.join(".")}: ${issue.message}`
            : "Invalid registration data",
        },
      });
      return;
    }
    const { username, email, password, confirmPassword } = parsed.data;
    if (confirmPassword !== undefined && confirmPassword !== password) {
      res.status(400).json({
        error: { code: "PASSWORD_MISMATCH", message: "Passwords do not match" },
      });
      return;
    }

    const usernameTaken = await db.orm.public.User
      .where({ username })
      .first();
    if (usernameTaken) {
      res.status(409).json({
        error: { code: "USERNAME_TAKEN", message: "Username is already taken" },
      });
      return;
    }
    const emailTaken = await db.orm.public.User
      .where({ email: email.toLowerCase() })
      .first();
    if (emailTaken) {
      res.status(409).json({
        error: { code: "EMAIL_TAKEN", message: "Email is already registered" },
      });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await db.orm.public.User.create({
      email: email.toLowerCase(),
      username,
      passwordHash,
      role: "USER",
      status: "ACTIVE",
    });

    const accessToken = await issueSession(req, res, user);
    reqLog(req).info("user_registered", { user_id: user.id });

    const balance = await db.orm.public.UserBalance
      .where({ userId: user.id })
      .first();
    res.status(201).json({
      accessToken,
      user: {
        ...publicUser(user),
        balance: {
          available: Number(balance?.available ?? 0),
          currency: balance?.currency ?? "RUB",
        },
      },
    });
  } catch (error) {
    reqLog(req).error("user_register_failed", { error });
    res.status(500).json({
      error: { code: "SERVER_ERROR", message: "Registration failed" },
    });
  }
});

// POST /auth/login - PLAN-001 A-002 (username OR email + password)
router.post("/login", authRateLimit, userRateLimit({ windowMs: 60_000, max: parseInt(process.env.LOGIN_RATE_LIMIT_MAX || "10", 10), action: "login" }), async (req: Request, res: Response) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        error: { code: "VALIDATION_ERROR", message: "login and password are required" },
      });
      return;
    }
    const { login, password } = parsed.data;
    const isEmail = login.includes("@");

    const user = isEmail
      ? await db.orm.public.User.where({ email: login.toLowerCase() }).first()
      : await db.orm.public.User.where({ username: login }).first();

    // Uniform error for both unknown identity and bad password.
    if (!user || !user.passwordHash) {
      reqLog(req).warn("login_failed_unknown_identity", { via: isEmail ? "email" : "username" });
      res.status(401).json({
        error: { code: "INVALID_CREDENTIALS", message: "Invalid login or password" },
      });
      return;
    }
    const passwordOk = await bcrypt.compare(password, user.passwordHash);
    if (!passwordOk) {
      reqLog(req).warn("login_failed_bad_password", { user_id: user.id });
      res.status(401).json({
        error: { code: "INVALID_CREDENTIALS", message: "Invalid login or password" },
      });
      return;
    }
    if (user.status !== "ACTIVE") {
      res.status(403).json({
        error: { code: "ACCOUNT_DISABLED", message: `Account is ${user.status}` },
      });
      return;
    }

    const accessToken = await issueSession(req, res, user);
    reqLog(req).info("user_logged_in", { user_id: user.id, via: "password" });
    const balance = await db.orm.public.UserBalance
      .where({ userId: user.id })
      .first();
    res.json({
      accessToken,
      user: {
        ...publicUser(user),
        balance: {
          available: Number(balance?.available ?? 0),
          currency: balance?.currency ?? "RUB",
        },
      },
    });
  } catch (error) {
    reqLog(req).error("login_failed", { error });
    res.status(500).json({
      error: { code: "SERVER_ERROR", message: "Login failed" },
    });
  }
});

// POST /auth/refresh - Refresh access token with rotation
router.post("/refresh", authRateLimit, userRateLimit({ windowMs: 60_000, max: parseInt(process.env.REFRESH_RATE_LIMIT_MAX || "30", 10), action: "refresh" }), async (req: Request, res: Response) => {
  try {
    const refreshToken = req.cookies?.refresh_token;

    if (!refreshToken) {
      res.status(401).json({ error: "Refresh token required" });
      return;
    }

    const payload = verifyRefreshToken(refreshToken);

    if (!payload) {
      res.status(401).json({ error: "Invalid or expired refresh token" });
      return;
    }

    // Verify session exists by hashed token
    const refreshTokenHash = hashRefreshToken(refreshToken);
    const session = await db.orm.public.Session.where({ refreshTokenHash }).first();

    if (!session) {
      reqLog(req).warn("refresh_session_not_found", { user_id: payload.userId });
      res.status(401).json({ error: "Session not found" });
      return;
    }

    // SECURITY: Check for token reuse (rotation detection)
    if (session.reuseDetected) {
      reqLog(req).error("refresh_token_reuse_detected", {
        session_id: session.id,
        user_id: session.userId,
        token_family: session.tokenFamily,
      });

      // Revoke all sessions in this token family.
      // NOTE: the contract ORM's delete() removes a single row per call,
      // so the family is drained in a loop until it is empty.
      if (session.tokenFamily) {
        let guard = 0;
        while (guard++ < 1000) {
          const familySessions = await db.orm.public.Session.where({
            tokenFamily: session.tokenFamily,
          }).all();
          if (familySessions.length === 0) break;
          for (const familySession of familySessions) {
            await db.orm.public.Session.where({ id: familySession.id }).delete();
          }
        }
        reqLog(req).warn("token_family_sessions_revoked", { token_family: session.tokenFamily });
      } else {
        await db.orm.public.Session.where({ id: session.id }).delete();
      }

      clearRefreshCookie(res);
      res.status(401).json({
        error: "Token reuse detected",
        message: "All sessions revoked for security. Please log in again."
      });
      return;
    }

    const expiresAt = new Date(session.expiresAt);
    if (expiresAt < new Date()) {
      // Delete expired session
      await db.orm.public.Session.where({ id: session.id }).delete();
      clearRefreshCookie(res);
      res.status(401).json({ error: "Session expired" });
      return;
    }

    // Generate new tokens (rotation)
    const newAccessToken = generateAccessToken(payload);
    const newRefreshToken = generateRefreshToken(payload);
    const newRefreshTokenHash = hashRefreshToken(newRefreshToken);

    // Mark old session as used (for reuse detection)
    await db.orm.public.Session.where({ id: session.id }).update({
      reuseDetected: true,
    });

    // Create new session (rotation)
    await db.orm.public.Session.create({
      userId: session.userId,
      refreshTokenHash: newRefreshTokenHash,
      tokenFamily: session.tokenFamily,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      lastRotatedAt: new Date().toISOString(),
      ipAddress: req.ip || req.socket.remoteAddress,
      userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : undefined,
    });

    // Set new refresh token cookie (rotation)
    setRefreshCookie(res, newRefreshToken);

    res.json({
      accessToken: newAccessToken,
      expiresIn: process.env.JWT_ACCESS_EXPIRY || "15m",
    });
  } catch (error) {
    reqLog(req).error("refresh_token_failed", { error });
    res.status(500).json({ error: "Failed to refresh token" });
  }
});

// POST /auth/logout - Logout
router.post("/logout", authRateLimit, async (req: Request, res: Response) => {
  try {
    const refreshToken = req.cookies?.refresh_token;

    if (!refreshToken) {
      res.status(400).json({ error: "Refresh token required" });
      return;
    }

    // Delete session by hashed token
    const refreshTokenHash = hashRefreshToken(refreshToken);
    const session = await db.orm.public.Session.where({ refreshTokenHash }).first();

    if (session) {
      await db.orm.public.Session.where({ id: session.id }).delete();
    }

    // Clear refresh token cookie
    clearRefreshCookie(res);

    res.json({ message: "Logged out successfully" });
  } catch (error) {
    reqLog(req).error("logout_failed", { error });
    res.status(500).json({ error: "Failed to logout" });
  }
});

// PATCH /auth/me - edit allowed profile fields (PLAN-001 B-002).
// role, status, email, username and any protected/identity fields are NOT
// editable here — attempts are ignored/rejected.
router.patch("/me", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const allowed: Record<string, unknown> = {};
    for (const key of ["displayName", "avatar"] as const) {
      if (req.body?.[key] !== undefined) allowed[key] = req.body[key];
    }
    const rejected = Object.keys(req.body ?? {}).filter(
      (k) => !["displayName", "avatar"].includes(k)
    );
    if (Object.keys(allowed).length === 0) {
      res.status(400).json({
        error: {
          code: "NOTHING_TO_UPDATE",
          message: "Only displayName and avatar are editable",
          rejectedFields: rejected,
        },
      });
      return;
    }
    const updated = await db.orm.public.User
      .where({ id: req.user!.userId })
      .update(allowed);
    reqLog(req).info("profile_updated", {
      user_id: req.user!.userId,
      fields: Object.keys(allowed),
    });
    res.json(updated);
  } catch (error) {
    reqLog(req).error("profile_update_failed", { error });
    res.status(500).json({ error: "Failed to update profile" });
  }
});

// GET /auth/me - Get current user (authenticated)
router.get("/me", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const user = await db.orm.public.User.where({ id: req.user!.userId }).first();

    if (!user) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // PLAN-001 C-003: the balance travels with the profile.
    await ensureUserBalance(user.id);
    const balance = await db.orm.public.UserBalance
      .where({ userId: user.id })
      .first();

    res.json({
      id: user.id,
      email: user.email,
      username: user.username,
      displayName: user.displayName,
      avatar: user.avatar,
      role: user.role,
      status: user.status,
      createdAt: user.createdAt,
      balance: {
        available: Number(balance?.available ?? 0),
        currency: balance?.currency ?? "RUB",
      },
    });
  } catch (error) {
    reqLog(req).error("get_user_failed", { error });
    res.status(500).json({ error: "Failed to get user" });
  }
});

// GET /auth/identities - List current user's linked identities (D-002)
router.get("/identities", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const accounts = await db.orm.public.Account.where({ userId: req.user!.userId }).all();

    // No token fields are ever exposed here.
    res.json(
      accounts.map((account) => ({
        id: account.id,
        provider: account.provider,
        providerAccountId: account.providerAccountId,
      }))
    );
  } catch (error) {
    reqLog(req).error("list_identities_failed", { error });
    res.status(500).json({ error: "Failed to list identities" });
  }
});

// DELETE /auth/identities/:id - Unlink an identity (D-002)
router.delete("/identities/:id", authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const account = await db.orm.public.Account.where({ id: String(req.params.id) }).first();

    if (!account || account.userId !== req.user!.userId) {
      res.status(404).json({ error: "Identity not found" });
      return;
    }

    // A user must always keep at least one login method.
    const allAccounts = await db.orm.public.Account.where({ userId: req.user!.userId }).all();
    if (allAccounts.length <= 1) {
      res.status(409).json({ error: "Cannot unlink the only login method" });
      return;
    }

    await db.orm.public.Account.where({ id: account.id }).delete();

    reqLog(req).info("identity_unlinked", {
      user_id: req.user!.userId,
      provider: account.provider.toLowerCase(),
    });

    res.json({ message: "Identity unlinked" });
  } catch (error) {
    reqLog(req).error("unlink_identity_failed", { error });
    res.status(500).json({ error: "Failed to unlink identity" });
  }
});

// GET /auth/:provider/link - Start the identity LINKING flow (authenticated).
// Sets the link_user cookie then redirects into the normal authorize route.
router.get("/:provider/link", authenticate, authRateLimit, async (req: AuthRequest, res: Response) => {
  const providerName = String(req.params.provider).toLowerCase();
  const provider = identityProviders.get(providerName);

  if (!provider || !provider.isEnabled()) {
    res.status(404).json({ error: "Provider not available" });
    return;
  }

  try {
    const user = await db.orm.public.User.where({ id: req.user!.userId }).first();
    if (!user) {
      res.status(401).json({ error: "User not found" });
      return;
    }

    const { authorizationUrl, state } = provider.getAuthorizationUrl({
      redirectUri: provider.getRedirectUri(),
    });

    if (!authorizationUrl || !state) {
      res.status(500).json({ error: "Provider not configured" });
      return;
    }

    setOAuthCookies(res, state);
    res.cookie(LINK_USER_COOKIE, generateAccessToken({ userId: user.id, email: user.email, role: user.role }), OAUTH_COOKIE_ATTRS);

    res.redirect(authorizationUrl);
  } catch (error) {
    reqLog(req).error("oauth_authorize_failed", { provider: providerName, error });
    res.status(500).json({ error: "Failed to start linking" });
  }
});

// GET /auth/:provider - Redirect to the provider's authorize URL.
// Authenticated requests (linking mode) also receive a link_user cookie.
router.get("/:provider", authRateLimit, async (req: Request, res: Response) => {
  const providerName = String(req.params.provider).toLowerCase();
  const provider = identityProviders.get(providerName);

  if (!provider || !provider.isEnabled()) {
    res.status(404).json({ error: "Provider not available" });
    return;
  }

  try {
    const { authorizationUrl, state } = provider.getAuthorizationUrl({
      redirectUri: provider.getRedirectUri(),
    });

    if (!authorizationUrl || !state) {
      res.status(500).json({ error: "Provider not configured" });
      return;
    }

    setOAuthCookies(res, state);

    // Linking mode: an authenticated request links instead of logging in.
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const payload = verifyAccessToken(authHeader.substring(7));
      if (payload) {
        res.cookie(LINK_USER_COOKIE, generateAccessToken(payload), OAUTH_COOKIE_ATTRS);
      }
    }

    res.redirect(authorizationUrl);
  } catch (error) {
    reqLog(req).error("oauth_authorize_failed", { provider: providerName, error });
    res.status(500).json({ error: "Failed to start authentication" });
  }
});

// GET /auth/:provider/callback - OAuth2 callback (login or link mode)
router.get("/:provider/callback", authRateLimit, async (req: Request, res: Response) => {
  const providerName = String(req.params.provider).toLowerCase();
  const provider = identityProviders.get(providerName);

  if (!provider || !provider.isEnabled()) {
    res.status(404).json({ error: "Provider not available" });
    return;
  }

  // CSRF: verify the state query parameter against the short-lived cookie.
  const queryState = typeof req.query.state === "string" ? req.query.state : undefined;
  const cookieState = req.cookies?.[OAUTH_STATE_COOKIE];

  if (!queryState || !cookieState || queryState !== cookieState) {
    reqLog(req).warn("oauth_state_mismatch", { provider: providerName });
    clearOAuthCookies(res);
    res.status(400).json({ error: "Invalid state" });
    return;
  }

  const code = typeof req.query.code === "string" ? req.query.code : undefined;
  if (!code) {
    clearOAuthCookies(res);
    res.status(400).json({ error: "Missing code parameter" });
    return;
  }

  try {
    const { tokens, user } = await provider.handleCallback({
      code,
      state: queryState,
      redirectUri: provider.getRedirectUri(),
    });

    const linkToken = req.cookies?.[LINK_USER_COOKIE];
    if (linkToken) {
      await handleLinkingCallback(req, res, providerName, linkToken, user);
      return;
    }

    await handleLoginCallback(req, res, providerName, tokens, user);
  } catch (error) {
    clearOAuthCookies(res);
    reqLog(req).error("oauth_callback_failed", { provider: providerName, error });
    res.status(500).json({ error: "Authentication failed" });
  }
});

/** LINKING MODE: attach the provider identity to an already authenticated user. */
async function handleLinkingCallback(
  req: Request,
  res: Response,
  providerName: string,
  linkToken: string,
  user: { providerId: string }
): Promise<void> {
  clearOAuthCookies(res);

  const payload = verifyAccessToken(linkToken);
  if (!payload) {
    res.status(401).json({ error: "Link session expired" });
    return;
  }

  const linkingUser = await db.orm.public.User.where({ id: payload.userId }).first();
  if (!linkingUser) {
    res.status(401).json({ error: "Link session expired" });
    return;
  }

  const providerUpper = providerName.toUpperCase();
  const existingAccount = await db.orm.public.Account.where({
    provider: providerUpper,
    providerAccountId: user.providerId,
  }).first();

  if (existingAccount && existingAccount.userId !== linkingUser.id) {
    reqLog(req).warn("identity_link_conflict", {
      user_id: linkingUser.id,
      provider: providerName,
      owner_user_id: existingAccount.userId,
    });
    res.status(409).json({ error: "Identity already linked to another account" });
    return;
  }

  if (existingAccount) {
    // Idempotent re-link.
    res.redirect(`${frontendUrl()}/account/identities?linked=1`);
    return;
  }

  await db.orm.public.Account.create({
    userId: linkingUser.id,
    provider: providerUpper,
    providerAccountId: user.providerId,
  });

  reqLog(req).info("identity_linked", { user_id: linkingUser.id, provider: providerName });

  res.redirect(`${frontendUrl()}/account/identities?linked=1`);
}

/** LOGIN MODE: sign the user in (creating the account/user when needed). */
async function handleLoginCallback(
  req: Request,
  res: Response,
  providerName: string,
  tokens: { accessToken: string; refreshToken?: string; expiresIn: number; tokenType?: string; scope?: string },
  user: {
    providerId: string;
    email?: string;
    username?: string;
    displayName?: string;
    avatar?: string;
    verified?: boolean;
  }
): Promise<void> {
  clearOAuthCookies(res);

  const providerUpper = providerName.toUpperCase();
  const epochExpiresAt = Math.floor(Date.now() / 1000) + tokens.expiresIn;

  const accountTokenFields = {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken || null,
    expiresAt: epochExpiresAt,
    tokenType: tokens.tokenType || null,
    scope: tokens.scope || null,
  };

  let account = await db.orm.public.Account.where({
    provider: providerUpper,
    providerAccountId: user.providerId,
  }).first();

  let targetUser;

  if (account) {
    // Returning user: the identity already maps to an account.
    targetUser = await db.orm.public.User.where({ id: account.userId }).first();
    if (!targetUser) {
      reqLog(req).error("identity_orphaned_account", { provider: providerName, account_id: account.id });
      res.status(500).json({ error: "Authentication failed" });
      return;
    }
    await db.orm.public.Account.where({ id: account.id }).update(accountTokenFields);
  } else {
    // SECURITY: never silently log in via an email match from an UNVERIFIED
    // provider email. Only verified emails may claim an existing user.
    let matchedByEmail = null;
    if (user.email && user.verified) {
      matchedByEmail = await db.orm.public.User.where({ email: user.email }).first();
    }

    if (matchedByEmail) {
      targetUser = matchedByEmail;
    } else {
      // Create a brand-new user. Unverified or missing emails get a
      // synthetic fallback address scoped to the provider id.
      const email = user.email && user.verified ? user.email : `${user.providerId}@${providerName}.local`;
      const username = await buildUsername(user.username || `${providerName}_${user.providerId}`);

      targetUser = await db.orm.public.User.create({
        email,
        username,
        displayName: user.displayName || username,
        avatar: user.avatar || null,
        role: "USER",
        status: "ACTIVE",
        ...(user.email && user.verified ? { emailVerified: new Date().toISOString() } : {}),
      });

      reqLog(req).info("user_created", { user_id: targetUser.id, provider: providerName });

      if (isRealEmail(email)) {
        sendWelcomeEmail(email, username).catch((err) =>
          reqLog(req).error("welcome_email_send_failed", { recipient: email, username, error: err })
        );
      }
    }

    account = await db.orm.public.Account.create({
      userId: targetUser.id,
      provider: providerUpper,
      providerAccountId: user.providerId,
      ...accountTokenFields,
    });
  }

  // Issue the session (refresh cookie holds the raw token; DB holds the hash).
  const refreshToken = generateRefreshToken({
    userId: targetUser.id,
    email: targetUser.email,
    role: targetUser.role,
  });

  const tokenFamily = generateTokenId(); // For rotation tracking

  await db.orm.public.Session.create({
    userId: targetUser.id,
    refreshTokenHash: hashRefreshToken(refreshToken),
    tokenFamily,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days
    ipAddress: req.ip || req.socket.remoteAddress,
    userAgent: req.headers["user-agent"],
  });

  // Store refresh token in HttpOnly cookie (TASK A-001/D-006).
  // The access token is NOT stored in any cookie: the frontend callback
  // page exchanges the refresh cookie for an access token via
  // POST /auth/refresh and keeps it in memory only.
  setRefreshCookie(res, refreshToken);

  reqLog(req).info("oauth_login_succeeded", { user_id: targetUser.id, provider: providerName });

  res.redirect(`${frontendUrl()}/auth/callback`);
}

export default router;
