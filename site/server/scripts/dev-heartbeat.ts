// PLAN-005 dev tool: локальный симулятор интеграции (роль mta-market-module).
//
// Использует ТОЛЬКО публичный API — как настоящий модуль:
//   login владельца -> выпуск integration token -> heartbeat каждые 45с.
// Данные остаются честными: это настоящий heartbeat от интеграции, просто
// интеграцию исполняет скрипт, а не модуль на сервере MTA.
//
// Запуск (отдельный терминал, пока работает API :3001):
//   pnpm --filter @mta-market/server exec tsx scripts/dev-heartbeat.ts
//
// Ctrl+C останавливает. Последний heartbeat серверов остаётся свежим ~3 мин,
// затем sweep переведёт их в UNKNOWN (E-006) — корректное поведение.
import "dotenv/config";

const API = process.env.DEV_API_URL || "http://localhost:3001";
const PASSWORD = "seed-password-123";
const INTERVAL_MS = 45_000;

interface Target {
  slug: string;
  owner: string;
  players: number;
  maxPlayers: number;
}

// Соответствует scripts/seed-plan005.ts (только live-серверы).
const TARGETS: Target[] = [
  { slug: "night-city-rp", owner: "nightcity_owner", players: 428, maxPlayers: 800 },
  { slug: "red-count", owner: "redcounty_admin", players: 152, maxPlayers: 300 },
  { slug: "dust-rally", owner: "dustdevils_lead", players: 87, maxPlayers: 200 },
  { slug: "cedar-falls", owner: "cedarfallsmc", players: 64, maxPlayers: 200 },
  { slug: "ghost-unit", owner: "ghostunit", players: 39, maxPlayers: 100 },
  { slug: "daybreak-drift", owner: "daybreakcrew", players: 112, maxPlayers: 150 },
  { slug: "aurora-league", owner: "auroraChief", players: 210, maxPlayers: 300 },
];

async function api(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${API}${path}`, init);
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    throw new Error(`${init?.method ?? "GET"} ${path} -> ${res.status}: ${text.slice(0, 200)}`);
  }
  return body;
}

async function login(username: string): Promise<string> {
  const res = await api("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login: username, password: PASSWORD }),
  });
  return res.accessToken as string;
}

async function issueToken(slug: string, token: string): Promise<string> {
  const res = await api(`/servers/${slug}/integration-token`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.token as string;
}

async function tick(tokens: Map<string, string>, targets: Target[]): Promise<void> {
  for (const t of targets) {
    const integrationToken = tokens.get(t.slug);
    if (!integrationToken) continue;
    // Лёгкий джиттер, чтобы график статистики выглядел живым.
    const jitter = Math.round(t.players * (0.92 + Math.random() * 0.16));
    try {
      await api("/integration/heartbeat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: integrationToken,
          players: jitter,
          maxPlayers: t.maxPlayers,
        }),
      });
    } catch (e) {
      console.warn(`[dev-heartbeat] ${t.slug}: ${(e as Error).message}`);
    }
  }
  console.log(`[dev-heartbeat] ${new Date().toISOString()} pinged ${targets.length} servers`);
}

async function main(): Promise<void> {
  console.log(`[dev-heartbeat] api=${API}`);
  const tokens = new Map<string, string>();
  for (const t of TARGETS) {
    try {
      const bearer = await login(t.owner);
      const integrationToken = await issueToken(t.slug, bearer);
      tokens.set(t.slug, integrationToken);
      console.log(`[dev-heartbeat] token issued for ${t.slug}`);
    } catch (e) {
      console.warn(`[dev-heartbeat] ${t.slug}: ${(e as Error).message}`);
    }
  }

  const live = TARGETS.filter((t) => tokens.has(t.slug));
  if (live.length === 0) {
    console.error("[dev-heartbeat] no targets configured; запустите seed-plan005.ts");
    process.exit(1);
  }

  await tick(tokens, live);
  setInterval(() => void tick(tokens, live), INTERVAL_MS);
  console.log(`[dev-heartbeat] running every ${INTERVAL_MS / 1000}s — Ctrl+C to stop`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});