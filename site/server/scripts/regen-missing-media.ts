// Восстановление потерянных dev-медиа: сканирует все /media/<name> URL в БД
// и заново генерирует PNG для файлов, отсутствующих в UPLOAD_DIR. URL в БД
// остаются прежними (имена content-addressed), поэтому ссылки продолжают работать.
//
// Запуск: pnpm --filter @mta-market/server exec tsx scripts/regen-missing-media.ts
import "dotenv/config";
import fs from "fs";
import path from "path";
import { db } from "../src/prisma/db";
import { generateCover, generateScreenshot } from "./lib/png";

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || "./uploads");

interface Missing {
  name: string;
  kind: "cover" | "screenshot" | "banner" | "logo" | "avatar";
  seed: string;
}

function extractName(url: unknown): string | null {
  if (typeof url !== "string") return null;
  const m = url.match(/^\/media\/(media-[0-9a-f]{64}\.png)$/);
  return m ? m[1] : null;
}

async function main() {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const missing = new Map<string, Missing>();

  const add = (url: unknown, kind: Missing["kind"], seed: string) => {
    const name = extractName(url);
    if (!name) return;
    if (!fs.existsSync(path.join(UPLOAD_DIR, name)) && !missing.has(name)) {
      missing.set(name, { name, kind, seed });
    }
  };

  console.log("[regen] collecting /media/ references...");

  for (const r of await db.orm.public.Resource.where({}).all()) {
    add(r.coverUrl, "cover", r.slug);
  }
  for (const m of await db.orm.public.ResourceMedia.where({}).all()) {
    add(m.url, m.kind === "SCREENSHOT" ? "screenshot" : "cover", m.url.slice(7, 39));
  }
  for (const s of await db.orm.public.Server.where({}).all()) {
    add(s.logoUrl, "logo", `${s.slug}-logo`);
    add(s.bannerUrl, "banner", `${s.slug}-banner`);
  }
  for (const n of await db.orm.public.ServerNews.where({}).all()) {
    add(n.coverUrl, "cover", `news-${n.slug ?? n.id}`);
  }
  for (const a of await db.orm.public.Article.where({}).all()) {
    add(a.coverUrl, "cover", `article-${a.slug}`);
  }
  for (const u of await db.orm.public.User.where({}).all()) {
    add(u.avatar, "avatar", `avatar-${u.username}`);
  }

  console.log(`[regen] missing files: ${missing.size}`);
  let done = 0;
  for (const m of missing.values()) {
    let png: Buffer;
    switch (m.kind) {
      case "banner":
        png = generateCover(m.seed, 1200, 300);
        break;
      case "logo":
        png = generateCover(m.seed, 256, 256);
        break;
      case "avatar":
        png = generateCover(m.seed, 128, 128);
        break;
      case "screenshot":
        png = generateScreenshot(m.seed, 0);
        break;
      default:
        png = generateCover(m.seed);
    }
    fs.writeFileSync(path.join(UPLOAD_DIR, m.name), png);
    done++;
    if (done % 20 === 0) console.log(`[regen] ${done}...`);
  }
  console.log(`[regen] restored ${done} media files into ${UPLOAD_DIR}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[regen] failed:", err);
  process.exit(1);
});
