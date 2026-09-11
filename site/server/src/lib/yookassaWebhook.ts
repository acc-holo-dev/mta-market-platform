// YooKassa webhook verification utilities
import crypto from "crypto";

/**
 * YooKassa notification IP addresses (as of 2024)
 * Source: https://yookassa.ru/developers/using-api/webhooks
 */
const YOOKASSA_IPS = [
  "185.71.76.0/27",
  "185.71.77.0/27",
  "77.75.153.0/25",
  "77.75.156.11",
  "77.75.156.35",
  "77.75.154.128/25",
  "2a02:5180::/32",
];

/**
 * Parse CIDR notation to check if IP is in range
 */
function ipInCIDR(ip: string, cidr: string): boolean {
  if (!cidr.includes('/')) {
    // Single IP
    return ip === cidr;
  }

  const [range, bits] = cidr.split('/');
  const mask = ~(2 ** (32 - parseInt(bits, 10)) - 1);

  const ipNum = ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0);
  const rangeNum = range.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0);

  return (ipNum & mask) === (rangeNum & mask);
}

/**
 * Check if IP address is from YooKassa
 */
export function isYooKassaIP(ip: string): boolean {
  // Skip IPv6 for now (just allow if it matches the prefix)
  if (ip.includes(':')) {
    return YOOKASSA_IPS.some(range => range.includes(':') && ip.startsWith(range.split('/')[0].slice(0, 10)));
  }

  return YOOKASSA_IPS.some(range => ipInCIDR(ip, range));
}

/**
 * Verify Basic Auth credentials for YooKassa webhook
 * YooKassa sends: Authorization: Basic base64(shopId:notificationPassword)
 * Comparison is timing-safe to avoid credential oracles.
 */
export function verifyYooKassaAuth(authHeader: string | undefined, expectedShopId: string, expectedPassword: string): boolean {
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return false;
  }

  const base64Credentials = authHeader.substring(6);
  const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
  const separator = credentials.indexOf(':');
  if (separator === -1) {
    return false;
  }
  const shopId = credentials.slice(0, separator);
  const password = credentials.slice(separator + 1);

  const shopIdOk = timingSafeEqualStr(shopId, expectedShopId);
  const passwordOk = timingSafeEqualStr(password, expectedPassword);
  return shopIdOk && passwordOk;
}

/** Timing-safe string comparison (equal-length hashing to avoid length leaks). */
function timingSafeEqualStr(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/**
 * Get the client IP for the webhook allowlist.
 *
 * TASK A-010: do NOT parse X-Forwarded-For manually — a spoofable,
 * attacker-controlled header. Express computes req.ip from the trusted
 * proxy chain (app.set('trust proxy', 1) matches the nginx topology), so
 * req.ip is the address of the direct peer (the proxy) or the real client
 * when a trusted proxy forwarded it. Only when no proxy topology is
 * configured does req.ip degrade to the socket address.
 */
export function getClientIP(req: { ip?: string; socket?: { remoteAddress?: string } }): string {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}
