// PLAN-003 Q: development seed — реалистичный dev-датасет marketplace.
//
// Что создаёт (идемпотентно, по slug):
//   - 4 продавца (APPROVED SellerProfile) + 5 покупателей;
//   - 16 PUBLISHED ресурсов всех типов: у каждого настоящая обложка и
//     скриншоты (PNG, сгенерированные scripts/lib/png.ts — без stock photos),
//     реальные ZIP-артефакты версий, отзывы и завершённые покупки
//     (настоящий popularity signal для сортировки «популярные»);
//   - 1 DRAFT ресурс (для проверки кабинета продавца). PENDING_REVIEW
//     намеренно не создаётся, чтобы очередь модерации оставалась пустой
//     между запусками E2E PLAN-001.
//
// Запуск: pnpm --filter @mta-market/server exec tsx scripts/seed-plan003.ts
import "dotenv/config";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { db } from "../src/prisma/db";
import { generateCover, generateScreenshot } from "./lib/png";

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || "./uploads");
const PASSWORD = "seed-password-123";

// ---------- helpers ----------
function writeArtifactZip(marker: string): { url: string; size: number; checksum: string } {
  const entryName = Buffer.from("meta/main.lua", "utf8");
  const content = Buffer.from(`return '${marker}'`, "utf8");
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of content) crc = (crc >>> 8) ^ table[(crc ^ b) & 0xff];
  crc = (crc ^ 0xffffffff) >>> 0;

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(content.length, 18);
  local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(entryName.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(content.length, 20);
  central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(entryName.length, 28);
  central.writeUInt32LE(30 + entryName.length, 42);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length + entryName.length, 12);
  eocd.writeUInt32LE(30 + entryName.length + content.length, 16);
  const zip = Buffer.concat([local, entryName, content, central, entryName, eocd]);

  const name = `${crypto.randomBytes(16).toString("hex")}.zip`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), zip);
  return {
    url: `/uploads/${name}`,
    size: zip.length,
    checksum: crypto.createHash("sha256").update(zip).digest("hex"),
  };
}

function writeMediaPng(png: Buffer): string {
  const name = `media-${crypto.randomBytes(32).toString("hex")}.png`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), png);
  return `/media/${name}`;
}

function daysAgoIso(days: number, hourOffset = 0): string {
  return new Date(Date.now() - days * 24 * 3600 * 1000 + hourOffset * 3600 * 1000).toISOString();
}

// ---------- sellers & buyers ----------
const SELLERS = [
  { username: "nightforge", displayName: "NightForge Studio", supportInfo: "Скрипты и интерфейсы. Поддержка в Discord, обновления бесплатные." },
  { username: "dunedragons", displayName: "Dune Dragons Team", supportInfo: "Карты и гейммоды для ролевых и гоночных серверов." },
  { username: "pixelera", displayName: "Pixelera", supportInfo: "Модели и текстуры в едином стиле." },
  { username: "soundsmith", displayName: "SoundSmith", supportInfo: "Звуковые паки и радио для серверов." },
];

const BUYERS = ["market_fan", "racer_x", "builder_pro", "casual_player", "collector"];

// ---------- resources ----------
interface SeedReview {
  buyer: string;
  rating: number;
  comment: string;
}

interface SeedResource {
  slug: string;
  title: string;
  description: string;
  type: "SCRIPT" | "MAP" | "MODEL" | "TEXTURE" | "SOUND" | "GAMEMODE";
  price: number;
  seller: string;
  screenshots: number;
  versions: { version: string; changelog: string; daysAgo: number }[];
  reviews: SeedReview[];
  purchases: string[];
  ageDays: number;
  draft?: boolean;
}

const RESOURCES: SeedResource[] = [
  {
    slug: "neon-hud-panels",
    title: "Neon HUD: панели интерфейса",
    description:
      "Готовый HUD-комплект для MTA:SA: панель здоровья и брони, мини-карта с настраиваемой прозрачностью, спидометр и виджет текущей задачи. Всё настраивается через один конфиг, поддержка экранов 16:9 и 21:9.",
    type: "SCRIPT",
    price: 34900,
    seller: "nightforge",
    ageDays: 9,
    screenshots: 3,
    versions: [
      { version: "2.1.0", changelog: "Масштабирование интерфейса на ультрашироких мониторах", daysAgo: 5 },
      { version: "2.0.0", changelog: "Новая тема оформления и тёмный режим", daysAgo: 40 },
    ],
    reviews: [
      { buyer: "market_fan", rating: 5, comment: "Лучший HUD из тех, что ставил. Конфиг понятный, поддержка быстрая." },
      { buyer: "racer_x", rating: 4, comment: "Всё работает, не хватило выбора шрифтов." },
      { buyer: "collector", rating: 5, comment: "Красиво и не режет FPS." },
    ],
    purchases: ["market_fan", "racer_x", "collector"],
  },
  {
    slug: "race-system-deluxe",
    title: "Race System Deluxe",
    description:
      "Полноценная гоночная система: создание трасс из интерфейса, контрольные точки, тайминги, топ-10 игроков, реверсы и реверс-режим. Синхронизация через встроенный экспорт результатов.",
    type: "SCRIPT",
    price: 89900,
    seller: "nightforge",
    ageDays: 21,
    screenshots: 4,
    versions: [
      { version: "3.2.1", changelog: "Исправлен подсчёт времени на реверс-трассах", daysAgo: 7 },
      { version: "3.2.0", changelog: "Редактор трасс прямо в игре", daysAgo: 30 },
      { version: "3.0.0", changelog: "Первый релиз с UI-редактором", daysAgo: 90 },
    ],
    reviews: [
      { buyer: "racer_x", rating: 5, comment: "Поставили на гоночный сервер — игроки довольны." },
      { buyer: "builder_pro", rating: 4, comment: "Мощно, но документация бы не помешала." },
    ],
    purchases: ["racer_x", "builder_pro", "market_fan", "collector", "casual_player"],
  },
  {
    slug: "scoreboard-pro",
    title: "Scoreboard Pro",
    description:
      "Табло игроков с группировкой по командам, пингом, страной и настраиваемыми колонками. Поддержка иконок ACL-групп, сортировка по любой колонке, автообновление без лагов.",
    type: "SCRIPT",
    price: 24900,
    seller: "nightforge",
    ageDays: 35,
    screenshots: 2,
    versions: [{ version: "1.4.0", changelog: "Фильтр по командам и экспорт в CSV", daysAgo: 35 }],
    reviews: [{ buyer: "casual_player", rating: 4, comment: "Стабильное табло, ставится за пять минут." }],
    purchases: ["builder_pro", "collector"],
  },
  {
    slug: "anticheat-sentinel",
    title: "Sentinel: базовая античит-защита",
    description:
      "Базовый античит-модуль: детектspeedhack, телепортов и инжект-сигнатур, лог подозрительных действий и авто-скриншот нарушителя. Лёгкая интеграция через один export.",
    type: "SCRIPT",
    price: 149900,
    seller: "nightforge",
    ageDays: 3,
    screenshots: 2,
    versions: [{ version: "0.9.0", changelog: "Бета: первый публичный релиз", daysAgo: 3 }],
    reviews: [],
    purchases: [],
  },
  {
    slug: "free-basic-hud",
    title: "Basic HUD (бесплатный)",
    description:
      "Простой и аккуратный HUD: здоровье, броня, деньги и оружие. Минимум настроек, ноль зависимостей — хороший старт для нового сервера.",
    type: "SCRIPT",
    price: 0,
    seller: "nightforge",
    ageDays: 60,
    screenshots: 2,
    versions: [{ version: "1.1.0", changelog: "Исправлено отображение при низком FPS", daysAgo: 60 }],
    reviews: [{ buyer: "casual_player", rating: 4, comment: "Для бесплатного — отлично." }],
    purchases: ["casual_player", "market_fan", "racer_x"],
  },
  {
    slug: "map-santa-marina",
    title: "Santa Marina Bay",
    description:
      "Карта прибрежного города: набережная, порт, жилые кварталы и трасса вдоль бухты. Оптимизирована под 200+ игроков, коллизии и LOD выверены вручную.",
    type: "MAP",
    price: 54900,
    seller: "dunedragons",
    ageDays: 14,
    screenshots: 4,
    versions: [
      { version: "1.2.0", changelog: "Добавлен порт и грузовой терминал", daysAgo: 14 },
      { version: "1.0.0", changelog: "Первый релиз", daysAgo: 75 },
    ],
    reviews: [
      { buyer: "builder_pro", rating: 5, comment: "Один из лучших порт-сити, что видел на MTA." },
      { buyer: "market_fan", rating: 4, comment: "Красиво, на слабых серверах просит оптимизацию." },
    ],
    purchases: ["builder_pro", "collector", "casual_player"],
  },
  {
    slug: "map-stadium-arena",
    title: "Stadium Arena X",
    description:
      "Многофункциональный стадион для DM/TDM ивентов и гонок: трибуны, подземный паркинг, четыре входа, отдельные спавн-зоны команд.",
    type: "MAP",
    price: 74900,
    seller: "dunedragons",
    ageDays: 45,
    screenshots: 3,
    versions: [{ version: "1.0.0", changelog: "Первый релиз", daysAgo: 45 }],
    reviews: [{ buyer: "racer_x", rating: 4, comment: "Отлично заходит для ивентов выходного дня." }],
    purchases: ["racer_x", "market_fan"],
  },
  {
    slug: "map-desert-outpost",
    title: "Desert Outpost (free)",
    description:
      "Небольшой форпост в пустыне: заправка, склад, наблюдательная вышка. Идеально для выживания или как промежуточная точка гонки.",
    type: "MAP",
    price: 0,
    seller: "dunedragons",
    ageDays: 80,
    screenshots: 2,
    versions: [{ version: "1.0.1", changelog: "Исправлена коллизия вышки", daysAgo: 80 }],
    reviews: [],
    purchases: ["casual_player"],
  },
  {
    slug: "vehicle-pack-street",
    title: "Street Vehicles Pack",
    description:
      "Восемь низкополигональных машин городской темы с кастомнымиHandling-пресетами. Модели в формате, готовом к импорту, с лодаи и тенями.",
    type: "MODEL",
    price: 129900,
    seller: "pixelera",
    ageDays: 30,
    screenshots: 3,
    versions: [
      { version: "1.1.0", changelog: "Добавлены два новых кузова и пресеты handling", daysAgo: 30 },
    ],
    reviews: [{ buyer: "collector", rating: 5, comment: "Модели чистые, полигоны в разумных пределах." }],
    purchases: ["collector", "builder_pro"],
  },
  {
    slug: "texture-neon-signs",
    title: "Neon Signs Texture Pack",
    description:
      "Сорок неоновых вывесок для коммерческих_districtов: бары, мотели, гаражи. Текстуры 512px, правильно настроенные emission-слои.",
    type: "TEXTURE",
    price: 0,
    seller: "pixelera",
    ageDays: 55,
    screenshots: 2,
    versions: [{ version: "1.0.0", changelog: "Первый релиз", daysAgo: 55 }],
    reviews: [],
    purchases: [],
  },
  {
    slug: "texture-asphalt-remaster",
    title: "Asphalt Remaster",
    description:
      "Переработанные дорожные текстуры: асфальт, разметка, тротуары. Четыре варианта погодного износа, бесшовные тайлы.",
    type: "TEXTURE",
    price: 19900,
    seller: "pixelera",
    ageDays: 26,
    screenshots: 3,
    versions: [{ version: "2.0.0", changelog: "Новый вариант износа и фикс швов", daysAgo: 26 }],
    reviews: [{ buyer: "builder_pro", rating: 5, comment: "Дороги наконец-то выглядят современно." }],
    purchases: ["builder_pro"],
  },
  {
    slug: "sound-lofi-radio",
    title: "Lo-Fi Radio Pack",
    description:
      "Двадцать треков lo-fi для внутриигрового радио: спокойный фон для ролевых серверов. Всё лицензионно чисто, метаданные заполнены.",
    type: "SOUND",
    price: 14900,
    seller: "soundsmith",
    ageDays: 18,
    screenshots: 2,
    versions: [{ version: "1.0.0", changelog: "Первый релиз", daysAgo: 18 }],
    reviews: [{ buyer: "market_fan", rating: 5, comment: "Отличный фон для roleplay-сервера." }],
    purchases: ["market_fan"],
  },
  {
    slug: "sound-sirens-pack",
    title: "Police Sirens Pack",
    description:
      "Десять реалистичных наборов сирен: wail, yelp, phaser и двухтональные. Совместимо с популярными скриптами полиции, лёгкая замена через конфиг.",
    type: "SOUND",
    price: 19900,
    seller: "soundsmith",
    ageDays: 66,
    screenshots: 1,
    versions: [{ version: "1.2.0", changelog: "Добавлены два двухтональных набора", daysAgo: 66 }],
    reviews: [{ buyer: "casual_player", rating: 4, comment: "Звучат заметно лучше стоковых." }],
    purchases: ["casual_player"],
  },
  {
    slug: "freeroam-basics",
    title: "Freeroam Basics (бесплатный)",
    description:
      "Минимальный freeroam-гейммод: спавн, телепорты, оружие, машины и погода через удобное меню. Хороший каркас, чтобы начать свой проект.",
    type: "GAMEMODE",
    price: 0,
    seller: "dunedragons",
    ageDays: 110,
    screenshots: 2,
    versions: [{ version: "1.0.0", changelog: "Первый релиз", daysAgo: 110 }],
    reviews: [],
    purchases: [],
  },
  {
    slug: "roleplay-core-frame",
    title: "Roleplay Core Frame",
    description:
      "Каркас ролевого сервера: аккаунты, персонажи, инвентарь, экономика, чат с логами и панель администратора. Готов к наращиванию своими системами.",
    type: "GAMEMODE",
    price: 249900,
    seller: "dunedragons",
    ageDays: 5,
    screenshots: 4,
    versions: [
      { version: "0.8.0", changelog: "Панель администратора и система жалоб", daysAgo: 5 },
      { version: "0.7.0", changelog: "Инвентарь и экономика", daysAgo: 25 },
    ],
    reviews: [
      { buyer: "builder_pro", rating: 5, comment: "Каркас именно такой, как нужен: ничего лишнего, всё расширяемо." },
      { buyer: "collector", rating: 4, comment: "Хорошая база, документацию бы подробнее." },
    ],
    purchases: ["builder_pro", "collector", "market_fan", "racer_x"],
  },
  {
    slug: "drift-physics-pack",
    title: "Drift Physics Pack",
    description:
      "Набор физических пресетов для дрифта: двадцать настроек подвески, дым шин, счётчик очков и комбо-система для ивентов.",
    type: "SCRIPT",
    price: 44900,
    seller: "nightforge",
    ageDays: 2,
    screenshots: 3,
    versions: [{ version: "1.0.0", changelog: "Первый релиз", daysAgo: 2 }],
    reviews: [],
    purchases: [],
  },
  {
    slug: "map-island-resort-wip",
    title: "Island Resort (в разработке)",
    description:
      "Черновик курортного острова: отель, пирс и пляжная зона. Публикуется как превью, финальная версия выйдет отдельно.",
    type: "MAP",
    price: 0,
    seller: "dunedragons",
    ageDays: 1,
    screenshots: 0,
    versions: [],
    reviews: [],
    purchases: [],
    draft: true,
  },
];

// ---------- seed runner ----------
const buyerIds = new Map<string, string>();

async function upsertUser(username: string, displayName: string | null, role: "USER" | "ADMIN") {
  const existing = await db.orm.public.User.where({ username }).first();
  if (existing) return existing;
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  return db.orm.public.User.create({
    email: `${username}@mtamarket.dev`,
    username,
    displayName,
    passwordHash,
    role,
    status: "ACTIVE",
  });
}

async function main() {
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }

  console.log("Seed PLAN-003: создание пользователей...");
  const sellerIds = new Map<string, string>();
  for (const seller of SELLERS) {
    const user = await upsertUser(seller.username, seller.displayName, "USER");
    const profile = await db.orm.public.SellerProfile.where({ userId: user.id }).first();
    if (!profile) {
      await db.orm.public.SellerProfile.create({
        userId: user.id,
        status: "APPROVED",
        displayName: seller.displayName,
        supportInfo: seller.supportInfo,
        payoutEnabled: true,
      });
    }
    const sellerUser = await db.orm.public.User.where({ id: user.id }).first();
    if (sellerUser && !sellerUser.displayName) {
      await db.orm.public.User.where({ id: user.id }).update({ displayName: seller.displayName });
    }
    const fresh = await db.orm.public.User.where({ id: user.id }).first();
    if (fresh) sellerIds.set(seller.username, fresh.id);
  }

  for (const buyer of BUYERS) {
    const user = await upsertUser(buyer, buyer, "USER");
    buyerIds.set(buyer, user.id);
  }

  let createdCount = 0;
  for (const r of RESOURCES) {
    const existing = await db.orm.public.Resource.where({ slug: r.slug }).first();
    if (existing) {
      console.log(`= пропущен (уже есть): ${r.slug}`);
      continue;
    }

    const sellerId = sellerIds.get(r.seller);
    if (!sellerId) throw new Error(`Seller not found: ${r.seller}`);

    const createdAt = daysAgoIso(r.ageDays);
    const resource = await db.orm.public.Resource.create({
      sellerId,
      slug: r.slug,
      title: r.title,
      description: r.description,
      type: r.type,
      status: r.draft ? "DRAFT" : "PUBLISHED",
      price: r.price,
      createdAt,
      updatedAt: daysAgoIso(Math.max(0, r.ageDays - 1)),
    });

    if (r.draft) {
      console.log(`+ draft: ${r.slug}`);
      continue;
    }

    // Cover + screenshots (настоящие PNG).
    const coverUrl = writeMediaPng(generateCover(r.slug));
    await db.orm.public.Resource.where({ id: resource.id }).update({ coverUrl });

    for (let i = 0; i < r.screenshots; i++) {
      const url = writeMediaPng(generateScreenshot(r.slug, i));
      await db.orm.public.ResourceMedia.create({
        resourceId: resource.id,
        kind: "SCREENSHOT",
        url,
        position: i,
      });
    }

    // Versions с реальными zip-артефактами.
    for (const v of r.versions) {
      const artifact = writeArtifactZip(`${r.slug}-${v.version}`);
      await db.orm.public.ResourceVersion.create({
        resourceId: resource.id,
        version: v.version,
        changelog: v.changelog,
        fileUrl: artifact.url,
        fileSize: artifact.size,
        fileChecksum: artifact.checksum,
        publishedAt: daysAgoIso(v.daysAgo),
        releaseStatus: "PUBLISHED",
      });
    }

    // Reviews от реальных покупателей.
    for (const review of r.reviews) {
      const buyerId = buyerIds.get(review.buyer);
      if (!buyerId) continue;
      const existingReview = await db.orm.public.Review
        .where({ resourceId: resource.id, buyerId })
        .first();
      if (!existingReview) {
        await db.orm.public.Review.create({
          resourceId: resource.id,
          buyerId,
          rating: review.rating,
          comment: review.comment,
          createdAt: daysAgoIso(Math.max(1, r.ageDays - 2)),
        });
      }
    }

    // COMPLETED purchases — настоящий popularity signal (I-004).
    const versions = await db.orm.public.ResourceVersion.where({ resourceId: resource.id }).all();
    const latestVersion = versions.sort((a: any, b: any) => b.publishedAt.localeCompare(a.publishedAt))[0];
    let purchaseOffset = 0;
    for (const buyerName of r.purchases) {
      const buyerId = buyerIds.get(buyerName);
      if (!buyerId || !latestVersion) continue;
      purchaseOffset += 1;
      await db.orm.public.Purchase.create({
        buyerId,
        resourceId: resource.id,
        versionId: latestVersion.id,
        status: "COMPLETED",
        priceSnapshot: r.price,
        finalPrice: r.price,
        platformFee: Math.round(r.price * 0.1),
        sellerRevenue: r.price - Math.round(r.price * 0.1),
        createdAt: daysAgoIso(Math.max(0, r.ageDays - 1), purchaseOffset),
        completedAt: daysAgoIso(Math.max(0, r.ageDays - 1), purchaseOffset),
      });
    }

    createdCount += 1;
    console.log(`+ published: ${r.slug} (${r.type}, ${r.price === 0 ? "free" : Math.round(r.price / 100) + " RUB"})`);
  }

  console.log(`Seed завершён: создано ${createdCount} новых ресурсов, всего в датасете ${RESOURCES.length}.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  });
