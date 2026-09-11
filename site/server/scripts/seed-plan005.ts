// PLAN-005 §34: development seed — реалистичный датасет Community & Server.
//
// Что создаёт (идемпотентно: пользователи по username, серверы по slug,
// категории по slug, темы по точному заголовку):
//   - 12 пользователей (владельцы серверов, игроки, подписчики);
//   - 10 серверов MTA:SA с разным состоянием: ONLINE (данные heartbeat),
//     OFFLINE, UNKNOWN, VERIFIED/PENDING, SUSPENDED, разная приватность и
//     брендинг (логотипы/баннеры/обложки новостей — сгенерированные PNG,
//     без стоков);
//   - 7 форумных категорий и живые темы с ответами, реакциями, закреплением;
//   - серверные новости (PUBLISHED + DRAFT) и обновления (version/changelog);
//   - верифицированные отзывы серверов;
//   - подписки (ServerFollow) и уведомления (SERVER_NEWS / FORUM_REPLY).
//
// Пароль всех seed-пользователей: seed-password-123 (только dev).
//
// Запуск: pnpm --filter @mta-market/server exec tsx scripts/seed-plan005.ts
import "dotenv/config";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { db } from "../src/prisma/db";
import { generateCover, generateScreenshot } from "./lib/png";

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || "./uploads");
const PASSWORD = "seed-password-123";

function writeMediaPng(png: Buffer): string {
  const name = `media-${crypto.randomBytes(32).toString("hex")}.png`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), png);
  return `/media/${name}`;
}

function daysAgoIso(days: number, hourOffset = 0): string {
  return new Date(
    Date.now() - days * 24 * 3600 * 1000 + hourOffset * 3600 * 1000
  ).toISOString();
}

// ---------------------------------------------------------------------------
// Fixture data
// ---------------------------------------------------------------------------

interface SeedUser {
  username: string;
  displayName: string;
  owns: string; // server key
  follows: string[]; // server keys
}

const USERS: SeedUser[] = [
  { username: "nightcity_owner", displayName: "Viktor Vale", owns: "night-city-rp", follows: ["red-count", "dust-rally"] },
  { username: "redcounty_admin", displayName: "Mara Quinn", owns: "red-count", follows: ["night-city-rp"] },
  { username: "dustdevils_lead", displayName: "Oleg Prud", owns: "dust-rally", follows: ["night-city-rp", "red-count"] },
  { username: "sunsetwire", displayName: "Iris Kwan", owns: "sunset-wire", follows: ["night-city-rp"] },
  { username: "freeroamhost", displayName: "Dmitri Sok", owns: "freeroam-central", follows: [] },
  { username: "cedarfallsmc", displayName: "Nadia Frost", owns: "cedar-falls", follows: ["night-city-rp"] },
  { username: "ghostunit", displayName: "Semyon Grot", owns: "ghost-unit", follows: ["dust-rally"] },
  { username: "daybreakcrew", displayName: "Lena Maro", owns: "daybreak-drift", follows: ["red-count"] },
  { username: "auroraChief", displayName: "Paula Reine", owns: "aurora-league", follows: ["night-city-rp"] },
  { username: "market_fan", displayName: "Market Fan", owns: "harbor-heist", follows: ["night-city-rp", "red-count", "dust-rally"] },
  { username: "racer_x", displayName: "Racer X", owns: "", follows: ["dust-rally", "daybreak-drift", "aurora-league"] },
  { username: "casual_player", displayName: "Casual Player", owns: "", follows: ["sunset-wire", "cedar-falls"] },
  { username: "collector", displayName: "Collector", owns: "", follows: ["night-city-rp", "ghost-unit"] },
  { username: "builder_pro", displayName: "Builder Pro", owns: "", follows: ["night-city-rp"] },
];

interface SeedServer {
  key: string;
  name: string;
  description: string;
  region: string;
  lifecycle: "VERIFIED" | "ACTIVE" | "PENDING_VERIFICATION" | "SUSPENDED";
  verification: "VERIFIED" | "PENDING";
  monitoring: "ONLINE" | "OFFLINE" | "UNKNOWN";
  players: number | null;
  maxPlayers: number | null;
  showStats: boolean;
  showStaff: boolean;
  showResources: boolean;
  showCommunity: boolean;
  newsCount: number;
  draftNews: boolean;
  updates: { version: string; title: string; changelog: string; daysAgo: number }[];
  reviewCount: number;
}

const SERVERS: SeedServer[] = [
  {
    key: "night-city-rp",
    name: "Night City RP",
    description:
      "Крупный ролевой сервер MTA:SA в стиле киберпанк-метрополии: работы, бизнесы, фракции и полная экономика. Кастомный интерфейс, более 200 интерьеров, активная администрация 24/7.",
    region: "EU",
    lifecycle: "ACTIVE",
    verification: "VERIFIED",
    monitoring: "ONLINE",
    players: 428,
    maxPlayers: 800,
    showStats: true,
    showStaff: true,
    showResources: true,
    showCommunity: true,
    newsCount: 3,
    draftNews: true,
    updates: [
      { version: "2.5.0", title: "Весенний патч: банды и территории", changelog: "Система банд, захват территорий, новые бизнесы.", daysAgo: 6 },
      { version: "2.4.2", title: "Горячий фикс экономики", changelog: "Баланс зарплат, исправление дюпа склада.", daysAgo: 20 },
    ],
    reviewCount: 4,
  },
  {
    key: "red-count",
    name: "Red County Roleplay",
    description:
      "Атмосферный RP глубинки Сан-Андреаса: фермы, шериф, байкерские клубы и медленный прогресс. Для тех, кто устал от мегаполисов.",
    region: "EU",
    lifecycle: "ACTIVE",
    verification: "VERIFIED",
    monitoring: "ONLINE",
    players: 152,
    maxPlayers: 300,
    showStats: true,
    showStaff: false,
    showResources: false,
    showCommunity: true,
    newsCount: 2,
    draftNews: false,
    updates: [
      { version: "1.9.0", title: "Фермерский сезон", changelog: "Новые культуры, цены, засуха.", daysAgo: 12 },
    ],
    reviewCount: 3,
  },
  {
    key: "dust-rally",
    name: "Dust Rally Racing",
    description:
      "Гоночный сервер: еженедельные турниры, дрифт-зоны, ралли по пустыне, пит-стопы и командный зачёт. Рейтинг пилотов и рекорды трасс.",
    region: "CIS",
    lifecycle: "ACTIVE",
    verification: "VERIFIED",
    monitoring: "ONLINE",
    players: 87,
    maxPlayers: 200,
    showStats: true,
    showStaff: false,
    showResources: true,
    showCommunity: true,
    newsCount: 2,
    draftNews: false,
    updates: [
      { version: "3.1.0", title: "Сезон 7: пустынные этапы", changelog: "6 новых трасс, пит-стопы, погодные эффекты.", daysAgo: 9 },
    ],
    reviewCount: 3,
  },
  {
    key: "sunset-wire",
    name: "Sunset Wire Freeroam",
    description:
      "Свободная езда и летсплеи: паркур-парки, дерби и рандом-ивенты каждую пятницу. Дружелюбно к новичкам.",
    region: "EU",
    lifecycle: "VERIFIED",
    verification: "VERIFIED",
    monitoring: "OFFLINE",
    players: 0,
    maxPlayers: 128,
    showStats: true,
    showStaff: false,
    showResources: false,
    showCommunity: false,
    newsCount: 1,
    draftNews: false,
    updates: [],
    reviewCount: 2,
  },
  {
    key: "freeroam-central",
    name: "Freeroam Central",
    description: "Классический фрирум без лишних правил. Машины, оружие, мир на всех.",
    region: "CIS",
    lifecycle: "PENDING_VERIFICATION",
    verification: "PENDING",
    monitoring: "UNKNOWN",
    players: null,
    maxPlayers: 64,
    showStats: true,
    showStaff: false,
    showResources: false,
    showCommunity: false,
    newsCount: 0,
    draftNews: false,
    updates: [],
    reviewCount: 0,
  },
  {
    key: "cedar-falls",
    name: "Cedar Falls Survival",
    description:
      "Выживание с зомби-риском: дневные рейды за ресурсами, ночные обороны, крафт и общие базы. Команды до 8 человек.",
    region: "NA",
    lifecycle: "ACTIVE",
    verification: "VERIFIED",
    monitoring: "ONLINE",
    players: 64,
    maxPlayers: 200,
    // privacy showcase: statistics hidden by owner
    showStats: false,
    showStaff: true,
    showResources: false,
    showCommunity: true,
    newsCount: 2,
    draftNews: false,
    updates: [
      { version: "0.8.1", title: "Хардкор-режим и погода", changelog: "Событие бури, редкий лут.", daysAgo: 15 },
    ],
    reviewCount: 3,
  },
  {
    key: "ghost-unit",
    name: "Ghost Unit: Tactical DM",
    description:
      "Тактический deathmatch: отряды на 5 человек, учебка, собственные карты и серверные конфиги матчей.",
    region: "EU",
    lifecycle: "ACTIVE",
    verification: "VERIFIED",
    monitoring: "ONLINE",
    players: 39,
    maxPlayers: 100,
    showStats: true,
    showStaff: false,
    showResources: true,
    showCommunity: false,
    newsCount: 1,
    draftNews: false,
    updates: [
      { version: "2.0.0", title: "Кастомные матчи и зрители", changelog: "Режим наблюдателя, новые карты.", daysAgo: 20 },
    ],
    reviewCount: 2,
  },
  {
    key: "daybreak-drift",
    name: "Daybreak Drift",
    description: "Дрифт-сервер с собственными трассами и сезонными таблицами лидеров.",
    region: "CIS",
    lifecycle: "ACTIVE",
    verification: "VERIFIED",
    monitoring: "ONLINE",
    players: 112,
    maxPlayers: 150,
    showStats: true,
    showStaff: false,
    showResources: false,
    showCommunity: true,
    newsCount: 2,
    draftNews: true,
    updates: [
      { version: "1.4.0", title: "Обновление физики заноса", changelog: "Переработан наклон кузова.", daysAgo: 4 },
    ],
    reviewCount: 2,
  },
  {
    key: "harbor-heist",
    name: "Harbor Heist Co-op",
    description:
      "Кооперативные ограбления порта: планирование, взлом, конвой и раздел добычи. (Сейчас приостановлен модерацией.)",
    region: "EU",
    lifecycle: "SUSPENDED",
    verification: "PENDING",
    monitoring: "UNKNOWN",
    players: null,
    maxPlayers: 100,
    showStats: true,
    showStaff: false,
    showResources: false,
    showCommunity: false,
    newsCount: 0,
    draftNews: false,
    updates: [],
    reviewCount: 0,
  },
  {
    key: "aurora-league",
    name: "Aurora League",
    description:
      "Киберспортивная лига MTA:SA: рейтинговые сезоны, официальные трансляции и призовые фонды.",
    region: "NA",
    lifecycle: "ACTIVE",
    verification: "VERIFIED",
    monitoring: "ONLINE",
    players: 210,
    maxPlayers: 300,
    showStats: true,
    showStaff: true,
    showResources: false,
    showCommunity: true,
    newsCount: 2,
    draftNews: true,
    updates: [
      { version: "4.0.0", title: "Старт сезона 8", changelog: "Новый рейтинг, карты и трансляции.", daysAgo: 2 },
    ],
    reviewCount: 3,
  },
];

const CATEGORIES = [
  { slug: "general", name: "Общее", description: "Новости платформы и свободные темы.", position: 1 },
  { slug: "servers", name: "Серверы", description: "Обсуждение серверов, наборы, партнёрства.", position: 2 },
  { slug: "scripting", name: "Скриптинг", description: "Lua, MTA API, оптимизация, помощь по коду.", position: 3 },
  { slug: "resources", name: "Ресурсы", description: "Маркетплейс-ресурсы и запросы на разработку.", position: 4 },
  { slug: "development", name: "Разработка", description: "Инструменты, инфраструктура, интеграции.", position: 5 },
  { slug: "help", name: "Помощь", description: "Вопросы новичков и поддержка.", position: 6 },
  { slug: "off-topic", name: "Флудилка", description: "Темы не про MTA — отдых от вождения.", position: 7 },
];

interface SeedThread {
  category: string;
  author: string;
  title: string;
  content: string;
  replies: { author: string; content: string; daysAgo: number }[];
  pinned?: boolean;
  state?: "OPEN" | "LOCKED" | "ARCHIVED";
  serverKey?: string;
  daysAgo: number;
}

const THREADS: SeedThread[] = [
  {
    category: "servers",
    author: "nightcity_owner",
    title: "Night City RP — открытие 8 сезона",
    content:
      "Мы переехали на новый хостинг, подняли слоты до 800 и переписали систему работ. Рассказываем, что изменилось и что планируем дальше.",
    replies: [
      { author: "market_fan", content: "Лучший RP этого сезона — экономика наконец живая.", daysAgo: 5 },
      { author: "casual_player", content: "Зашёл на день — залип на неделю. Работа таксистом топ.", daysAgo: 4 },
      { author: "collector", content: "Будут ли эксклюзивные машины за внутриигровую валюту?", daysAgo: 3 },
    ],
    serverKey: "night-city-rp",
    daysAgo: 7,
    pinned: true,
  },
  {
    category: "scripting",
    author: "nightcity_owner",
    title: "Как вы профилируете нагрузку Lua-ресурсов?",
    content:
      "Делимся практиками профилирования: onClientRender, таймеры, большие таблицы. Что используете в своих проектах?",
    replies: [
      { author: "dustdevils_lead", content: "Профилировщик + счётчики в табло. Главное зло — таймеры на 50мс.", daysAgo: 6 },
      { author: "freeroamhost", content: "setTimer с малым интервалом — первый кандидат на оптимизацию.", daysAgo: 5 },
    ],
    daysAgo: 6,
  },
  {
    category: "servers",
    author: "redcounty_admin",
    title: "Ищем маппера для глубинки (RP, долгосрок)",
    content:
      "Нужен человек на карту фермерского округа: ~40 объектов, стиль реалистичный. Оплата по этапам через маркет.",
    replies: [{ author: "daybreakcrew", content: "Написал в личку, есть примеры работ.", daysAgo: 8 }],
    serverKey: "red-count",
    daysAgo: 9,
  },
  {
    category: "resources",
    author: "racer_x",
    title: "Race System Deluxe — кто уже ставил на турниры?",
    content: "Думаем взять на сезонный кубок. Как ведёт себя на 100+ игроках?",
    replies: [
      { author: "dustdevils_lead", content: "Три сезона на нашем проекте — летает, латентности нет.", daysAgo: 7 },
      { author: "market_fan", content: "Тайминги честные, экспорт результатов удобный.", daysAgo: 6 },
    ],
    daysAgo: 8,
  },
  {
    category: "help",
    author: "casual_player",
    title: "Не активируется DRM-лицензия после переноса сервера",
    content: "Перенесли сервер на новый хостинг — лицензия не активируется. Куда смотреть?",
    replies: [
      { author: "ghostunit", content: "Проверь machine-id: ключ установки привязан к машине.", daysAgo: 10 },
    ],
    daysAgo: 11,
  },
  {
    category: "off-topic",
    author: "sunsetwire",
    title: "Скриншоты недели: дерби на закате",
    content: "Собрал подборку кадров с пятничного дерби. Делитесь своими!",
    replies: [
      { author: "collector", content: "Кадр с переворотом — просто арт.", daysAgo: 2 },
      { author: "racer_x", content: "Жду субботний заезд.", daysAgo: 1 },
    ],
    daysAgo: 3,
  },
  {
    category: "development",
    author: "auroraChief",
    title: "Мониторинг серверов через интеграцию MTA Market",
    content:
      "Подключили heartbeat-интеграцию: онлайн теперь виден на странице сервера в реальном времени. Кто ещё пробовал?",
    replies: [
      { author: "nightcity_owner", content: "У нас работает, график онлайна удобный.", daysAgo: 2 },
    ],
    serverKey: "aurora-league",
    daysAgo: 2,
  },
];

const NEWS_TITLES = [
  "Обновление {server}: что нового",
  "Ивент недели на {server}",
  "Открытие нового сезона на {server}",
];

const NEWS_CONTENT = [
  "Мы обновили ядро проекта: переработали экономику, добавили новые механики и исправили десятки багов. Подробности внутри.",
  "В эту субботу большой ивент: призы, турнирная таблица и трансляция. Не пропустите!",
  "Сезон перезапускается: новые правила, свежий вайп экономики и подарки первым игрокам.",
];

const REVIEW_COMMENTS = [
  "Отличная атмосфера и живой онлайн, администрация реагирует быстро.",
  "Хороший сервер, но иногда лагает в час пик.",
  "Играл месяц: экономика и ивенты на уровне.",
];

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

async function ensureUser(username: string, displayName: string): Promise<string> {
  const existing = await db.orm.public.User.where({ username }).first();
  if (existing) return existing.id;
  const passwordHash = bcrypt.hashSync(PASSWORD, 10);
  const user = await db.orm.public.User.create({
    email: `${username}@seed.mtamarket.local`,
    passwordHash,
    username,
    displayName,
    role: "USER",
    status: "ACTIVE",
  });
  await db.orm.public.UserBalance.create({ userId: user.id }).catch(() => undefined);
  return user.id;
}


// ---------------------------------------------------------------------------
// PLAN-007: Content Foundation — статьи (идемпотентно по slug).
// Реалистичные материалы экосистемы, включая примеры из DAILY-EXPERIENCE.
// ---------------------------------------------------------------------------
const ARTICLES = [
  {
    slug: "kakoi-framework-vybrat-dlya-rp",
    author: "nightcity_owner",
    title: "Какой framework выбрать для RP-сервера",
    category: "GUIDES",
    tags: "roleplay, framework, старт",
    daysAgo: 3,
    coverSeed: "article-framework",
    content:
      "Выбор фреймворка определяет всё развитие сервера: скорость старта, стоимость поддержки и то, насколько свободно вы сможете реализовывать идеи.\n\nСобственный фреймворк даёт полный контроль, но требует месяцев работы сильного разработчика. Готовые решения (полные сборки) запускаются за день, однако привязывают вас к чужой архитектуре и качеству кода.\n\nКомпромисс, который выбирает большинство успешных проектов: готовое ядро плюс собственные модули поверх. Так вы проверяете идею быстро, а уникальные механики пишете сами.\n\nСмотрите разборы готовых ресурсов в маркетплейсе и читайте отзывы владельцев серверов перед решением.",
    serverKey: "night-city-rp",
    withThread: true,
  },
  {
    slug: "optimizaciya-mta-servera-taimery",
    author: "dustdevils_lead",
    title: "Оптимизация MTA-сервера: таймеры и колбэки",
    category: "GUIDES",
    tags: "оптимизация, lua",
    daysAgo: 2,
    coverSeed: "article-optimization",
    content:
      "Главное зло производительности MTA-сервера — таймеры с малыми интервалами. setTimer на 50мс, запущенный в десятке ресурсов, съедает кадры серверного цикла незаметно.\n\nПравило простое: событийная модель вместо опроса. onPlayerClick, onVehicleEnter и другие события заменяют 90% таймеров-опросников.\n\nВторой источник проблем — синхронные запросы к базе в горячем коде. Кэшируйте данные, которые читаются часто и меняются редко: топ игроков, цены магазинов, конфиги.\n\nПрофилируйте встроенным пef-инструментом сервера и смотрите раздел мониторинга вашего сервера на MTA Market — рост среднего онлайна после оптимизации виден там же.",
    serverKey: "dust-rally",
    withThread: true,
  },
  {
    slug: "nochi-otkrytij-obnovlenie-2-5",
    author: "redcounty_admin",
    title: "Ночь открытий: сезонные ивенты в Red County",
    category: "NEWS",
    tags: "ивенты",
    daysAgo: 1,
    coverSeed: null as unknown as string,
    content:
      "В Red County стартовала серия ночных ивентов: гонки по закрытым трассам, осада ферм и охота за редкими машинами.\n\nРасписание меняется каждую неделю — следите за новостями сервера и обсуждением в теме.",
    serverKey: "red-count",
    withThread: false,
  },
  {
    slug: "demo-resursy-kak-proverit-pokupku",
    author: "racer_x",
    title: "Демо-ресурсы: как проверить покупку до оплаты",
    category: "REVIEWS",
    tags: "маркетплейс, drm",
    daysAgo: 5,
    coverSeed: null as unknown as string,
    content:
      "На MTA Market у каждого ресурса есть лицензия и защита: покупка выдаёт персональную лицензию с привязкой к вашему серверу.\n\nПрежде чем покупать платный ресурс, изучите бесплатные демо-версии того же автора: они показывают стиль кода и качество документации.\n\nОтзывы с меткой Verified Interaction означают подтверждённое взаимодействие с сервером — доверять им проще.",
    serverKey: null,
    withThread: false,
  },
];

async function seedArticles(userIds: Map<string, string>): Promise<void> {
  const category = await db.orm.public.ForumCategory.where({ slug: "servers" }).first()
    ?? (await db.orm.public.ForumCategory.orderBy((c: any) => c.position.asc()).first());
  for (const a of ARTICLES) {
    if (await db.orm.public.Article.where({ slug: a.slug }).first()) {
      console.log(`[seed-plan005] article ${a.slug} exists, skip`);
      continue;
    }
    const authorId = userIds.get(a.author);
    if (!authorId) continue;
    const coverUrl = a.coverSeed ? writeMediaPng(generateCover(a.coverSeed)) : null;
    const publishedAt = daysAgoIso(a.daysAgo);
    const article = await db.orm.public.Article.create({
      authorId,
      slug: a.slug,
      title: a.title,
      content: a.content,
      excerpt: a.content.replace(/\s+/g, " ").trim().slice(0, 297),
      coverUrl,
      category: a.category,
      tags: a.tags,
      status: "PUBLISHED",
      publishedAt,
    });
    if (a.serverKey) {
      const server = await db.orm.public.Server.where({ slug: a.serverKey }).first();
      if (server) {
        await db.orm.public.ArticleServerLink.create({ articleId: article.id, serverId: server.id, position: 0 });
      }
    }
    if (a.withThread && category) {
      const thread = await db.orm.public.ForumThread.create({
        categoryId: category.id,
        authorId,
        articleId: article.id,
        title: a.title,
      });
      await db.orm.public.ForumPost.create({
        threadId: thread.id,
        authorId,
        content: `Обсуждение статьи «${a.title}». ${a.content.slice(0, 120)}`,
        position: 0,
      });
      await db.orm.public.ForumThread
        .where({ id: thread.id })
        .update({ lastPostAt: publishedAt });
    }
    console.log(`[seed-plan005] article ${a.slug} created`);
  }

  // Драфт и статья в очереди модерации — для витрины статусов.
  const fanId = userIds.get("market_fan");
  if (fanId && !(await db.orm.public.Article.where({ slug: "chto-takoe-drm-na-mta-market" }).first())) {
    await db.orm.public.Article.create({
      authorId: fanId,
      slug: "chto-takoe-drm-na-mta-market",
      title: "Что такое DRM на MTA Market (черновик)",
      content:
        "DRM защищает платные ресурсы от массового копирования.\n\nЧерновик объясняет, как работает лицензия, lease и установка модуля.",
      excerpt: "DRM защищает платные ресурсы от массового копирования.",
      category: "GUIDES",
      status: "DRAFT",
    });
  }
  const racerId = userIds.get("racer_x");
  if (racerId && !(await db.orm.public.Article.where({ slug: "rendy-hostinga-mta-2026" }).first())) {
    await db.orm.public.Article.create({
      authorId: racerId,
      slug: "rendy-hostinga-mta-2026",
      title: "Тренды хостинга MTA-серверов в 2026",
      content:
        "Обзор тарифов хостеров, сравнение NVMe-дисков и пинга по регионам.\n\nМатериал отправлен на модерацию и появится после проверки.",
      excerpt: "Обзор тарифов хостеров, сравнение NVMe-дисков и пинга по регионам.",
      category: "OPINION",
      status: "PENDING_REVIEW",
    });
  }
}


// ---------------------------------------------------------------------------
// PLAN-008: Follow Expansion — подписки на создателей/ресурсы и примеры
// уведомлений (идемпотентно по unique-парам).
// ---------------------------------------------------------------------------
async function seedFollows(userIds: Map<string, string>): Promise<void> {
  const pairs: [string, string][] = [
    ["market_fan", "nightcity_owner"],
    ["racer_x", "nightcity_owner"],
    ["market_fan", "auroraChief"],
  ];
  for (const [fan, creator] of pairs) {
    const followerId = userIds.get(fan);
    const sellerUserId = userIds.get(creator);
    if (!followerId || !sellerUserId) continue;
    const existing = await db.orm.public.SellerFollow
      .where({ followerId, sellerUserId })
      .first();
    if (!existing) {
      await db.orm.public.SellerFollow.create({ followerId, sellerUserId });
    }
  }

  // Resource follows: фан следит за демо-ресурсами (если есть).
  const demoResources = await db.orm.public.Resource
    .where({ status: "PUBLISHED" })
    .limit(3)
    .all();
  const fanId = userIds.get("market_fan");
  for (const r of demoResources as any[]) {
    if (!fanId || r.sellerId === fanId) continue;
    const existing = await db.orm.public.ResourceFollow
      .where({ userId: fanId, resourceId: r.id })
      .first();
    if (!existing) {
      await db.orm.public.ResourceFollow.create({ userId: fanId, resourceId: r.id });
    }
  }

  // Примеры уведомлений новых типов (одноразово по заголовку).
  const examples: { type: any; recipient: string; title: string; body: string }[] = [
    {
      type: "CREATOR_RESOURCE",
      recipient: "market_fan",
      title: "Новинка от NightForge Studio: Drift Physics Pack",
      body: "Набор физических настроек для дрифта: двадцать пресетов.",
    },
    {
      type: "RESOURCE_UPDATE",
      recipient: "market_fan",
      title: "Santa Marina Bay — новая версия 1.2",
      body: "Набережная, порт, жилые кварталы: обновление коллизий.",
    },
    {
      type: "CREATOR_ARTICLE",
      recipient: "racer_x",
      title: "Новая статья от автора: Какой framework выбрать для RP-сервера",
      body: "Сравнение подходов к ядру RP-сервера.",
    },
  ];
  for (const ex of examples) {
    const recipientId = userIds.get(ex.recipient);
    if (!recipientId) continue;
    const existing = await db.orm.public.Notification
      .where({ recipientId, title: ex.title })
      .first();
    if (!existing) {
      await db.orm.public.Notification.create({
        recipientId,
        type: ex.type,
        title: ex.title,
        body: ex.body,
      });
    }
  }
  // PLAN-009: thread follows + пример уведомления подписчику темы.
  const threadFollowPairs: [string, string][] = [
    ["market_fan", "Какой framework выбрать для RP-сервера"],
    ["racer_x", "Какой framework выбрать для RP-сервера"],
  ];
  for (const [fan, threadTitle] of threadFollowPairs) {
    const followerId = userIds.get(fan);
    if (!followerId) continue;
    const thread = await db.orm.public.ForumThread.where({ title: threadTitle }).first();
    if (!thread) continue;
    const existing = await db.orm.public.ForumThreadFollow
      .where({ userId: followerId, threadId: thread.id })
      .first();
    if (!existing) {
      await db.orm.public.ForumThreadFollow.create({ userId: followerId, threadId: thread.id });
    }
  }
  const fanUserId = userIds.get("market_fan");
  if (fanUserId) {
    const frameworkThread = await db.orm.public.ForumThread
      .where({ title: "Какой framework выбрать для RP-сервера" })
      .first();
    if (frameworkThread) {
      const notifExists = await db.orm.public.Notification
        .where({ recipientId: fanUserId, entityType: "forumThread", entityId: frameworkThread.id })
        .first();
      if (!notifExists) {
        await db.orm.public.Notification.create({
          recipientId: fanUserId,
          type: "FORUM_REPLY",
          title: `Новый ответ в теме «${frameworkThread.title}»`,
          body: "Готовые ядра быстрее на старте, но собственные модули дают уникальность.",
        });
      }
    }
  }
  console.log("[seed-plan005] follows seeded");
}


// ---------------------------------------------------------------------------
// PLAN-010: Creator Analytics — история просмотров демо-ресурсов
// (агрегат ресурс × день; правдоподобные объёмы; идемпотентно).
// ---------------------------------------------------------------------------
async function seedResourceViews(): Promise<void> {
  const resources = await db.orm.public.Resource
    .where({ status: "PUBLISHED" })
    .limit(20)
    .all();
  for (const [i, r] of (resources as any[]).entries()) {
    for (let d = 0; d < 30; d++) {
      const day = new Date(Date.now() - d * 24 * 3600_000).toISOString().slice(0, 10);
      const existing = await db.orm.public.ResourceViewDaily
        .where({ resourceId: r.id, day })
        .first();
      if (existing) continue;
      // Волна интереса: новее — больше; разные ресурсы — разные объёмы.
      const base = 4 + ((i * 7) % 12);
      const views = Math.max(0, Math.round(base * (1 - d / 40) + ((d * 13 + i * 5) % 7)));
      if (views <= 0) continue;
      await db.orm.public.ResourceViewDaily.create({
        resourceId: r.id as string,
        day,
        views,
      });
    }
  }
  console.log("[seed-plan005] resource views seeded");
}

async function main(): Promise<void> {
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  console.log("[seed-plan005] start");

  // 1. Users
  const userIds = new Map<string, string>();
  for (const u of USERS) {
    userIds.set(u.username, await ensureUser(u.username, u.displayName));
  }
  console.log(`[seed-plan005] users: ${userIds.size}`);

  // 2. Forum categories
  for (const c of CATEGORIES) {
    const existing = await db.orm.public.ForumCategory.where({ slug: c.slug }).first();
    if (!existing) await db.orm.public.ForumCategory.create(c);
  }

  // 3. Servers
  for (const s of SERVERS) {
    const slug = s.key;
    if (await db.orm.public.Server.where({ slug }).first()) {
      console.log(`[seed-plan005] server ${slug} exists, skip`);
      continue;
    }
    const owner = USERS.find((u) => u.owns === s.key);
    if (!owner) {
      console.warn(`[seed-plan005] no owner configured for ${s.key}, skip`);
      continue;
    }
    const ownerId = userIds.get(owner.username)!;
    const logo = writeMediaPng(generateCover(`${s.key}-logo`, 256, 256));
    const banner = writeMediaPng(generateCover(`${s.key}-banner`, 960, 300));
    const lastSeen =
      s.monitoring === "ONLINE"
        ? daysAgoIso(0, -1)
        : s.monitoring === "OFFLINE"
          ? daysAgoIso(1)
          : null;

    const server = await db.orm.public.Server.create({
      ownerId,
      slug,
      name: s.name,
      description: s.description,
      logoUrl: logo,
      bannerUrl: banner,
      websiteUrl: null,
      discordUrl: `https://discord.gg/${s.key}`,
      host: s.monitoring === "UNKNOWN" ? null : "play.mtamarket.local",
      port: 22003 + (slug.length % 90),
      region: s.region,
      lifecycle: s.lifecycle,
      verification: s.verification,
      monitoring: s.monitoring,
      playerCount: s.showStats ? s.players : null,
      maxPlayers: s.showStats ? s.maxPlayers : null,
      lastSeenAt: lastSeen,
      verifiedAt: s.verification === "VERIFIED" ? daysAgoIso(20) : null,
      verificationNote:
        s.verification === "PENDING" ? "Ожидает первого heartbeat от интеграции" : null,
      showResources: s.showResources,
      showStaff: s.showStaff,
      showTechStack: false,
      showStats: s.showStats,
      showCommunity: s.showCommunity,
      createdAt: daysAgoIso(30),
    });
    await db.orm.public.ServerMember.create({
      serverId: server.id,
      userId: ownerId,
      role: "OWNER",
      createdAt: daysAgoIso(30),
    });

    // Monitoring samples — realistic shaped history (ONLINE/OFFLINE only).
    if (s.monitoring !== "UNKNOWN") {
      for (let i = 24; i > 0; i -= 1) {
        const base = s.players ?? 0;
        const jitter =
          s.monitoring === "OFFLINE" ? 0 : Math.max(0, Math.round(base * (0.75 + Math.random() * 0.4)));
        await db.orm.public.ServerStatusSample.create({
          serverId: server.id,
          state: s.monitoring,
          players: jitter,
          maxPlayers: s.maxPlayers,
          sampledAt: daysAgoIso(i / 24),
        }).catch(() => undefined);
      }
    }

    // Followers
    for (const u of USERS) {
      if (u.follows.includes(s.key)) {
        await db.orm.public.ServerFollow.create({
          serverId: server.id,
          userId: userIds.get(u.username)!,
          createdAt: daysAgoIso(10),
        }).catch(() => undefined);
      }
    }

    // News (published + optional draft)
    for (let i = 0; i < s.newsCount; i += 1) {
      await db.orm.public.ServerNews.create({
        serverId: server.id,
        authorId: ownerId,
        title: NEWS_TITLES[i % NEWS_TITLES.length].replace("{server}", s.name),
        content: NEWS_CONTENT[i % NEWS_CONTENT.length].replace("{server}", s.name),
        coverUrl: writeMediaPng(generateScreenshot(`${s.key}-news`, i, 640, 360)),
        status: "PUBLISHED",
        publishedAt: daysAgoIso(3 + i * 5),
        createdAt: daysAgoIso(4 + i * 5),
      });
    }
    if (s.draftNews) {
      await db.orm.public.ServerNews.create({
        serverId: server.id,
        authorId: ownerId,
        title: `Черновик: анонс ивента «${s.name}»`,
        content: "Анонс готовится к публикации — черновик текста.",
        status: "DRAFT",
        createdAt: daysAgoIso(1),
      });
    }

    // Updates
    for (const up of s.updates) {
      await db.orm.public.ServerUpdate.create({
        serverId: server.id,
        authorId: ownerId,
        version: up.version,
        title: up.title,
        changelog: up.changelog,
        publishedAt: daysAgoIso(up.daysAgo),
        createdAt: daysAgoIso(up.daysAgo + 1),
      });
    }

    // Verified reviews from followers
    const followerUsers = USERS.filter((u) => u.follows.includes(s.key));
    for (let i = 0; i < Math.min(s.reviewCount, followerUsers.length); i += 1) {
      const uid = userIds.get(followerUsers[i].username)!;
      const already = await db.orm.public.ServerReviewEligibility
        .where({ serverId: server.id, userId: uid })
        .first();
      if (already) continue;
      await db.orm.public.ServerReviewEligibility.create({
        serverId: server.id,
        userId: uid,
        grantedAt: daysAgoIso(8),
      });
      await db.orm.public.ServerReview.create({
        serverId: server.id,
        userId: uid,
        rating: 4 + (i % 2),
        comment: REVIEW_COMMENTS[(i + slug.length) % REVIEW_COMMENTS.length],
        verifiedInteraction: true,
        status: "VISIBLE",
        createdAt: daysAgoIso(7 - i),
      }).catch(() => undefined);
    }

    console.log(`[seed-plan005] server ${slug} seeded`);
  }

  // 3. Forum threads + posts + reactions + notifications
  for (const t of THREADS) {
    const category = await db.orm.public.ForumCategory.where({ slug: t.category }).first();
    const authorId = userIds.get(t.author);
    if (!category || !authorId) continue;
    if (await db.orm.public.ForumThread.where({ title: t.title }).first()) continue;
    let serverId: string | null = null;
    if (t.serverKey) {
      serverId = (await db.orm.public.Server.where({ slug: t.serverKey }).first())?.id ?? null;
    }
    const thread = await db.orm.public.ForumThread.create({
      categoryId: category.id,
      authorId,
      serverId,
      title: t.title,
      state: t.state ?? "OPEN",
      pinned: t.pinned ?? false,
      views: 20 + Math.floor(Math.random() * 200),
      createdAt: daysAgoIso(t.daysAgo + 1),
      updatedAt: daysAgoIso(t.daysAgo),
    });
    await db.orm.public.ForumPost.create({
      threadId: thread.id,
      authorId,
      content: t.content,
      position: 0,
      createdAt: daysAgoIso(t.daysAgo + 1),
    });
    await db.orm.public.ForumThread.where({ id: thread.id }).update({
      lastPostAt: daysAgoIso(t.daysAgo),
    });

    let replyIndex = 0;
    for (const r of t.replies) {
      const rid = userIds.get(r.author);
      if (!rid) continue;
      replyIndex += 1;
      const post = await db.orm.public.ForumPost.create({
        threadId: thread.id,
        authorId: rid,
        content: r.content,
        position: replyIndex,
        createdAt: daysAgoIso(r.daysAgo),
      });
      await db.orm.public.ForumThread.where({ id: thread.id }).update({
        replyCount: replyIndex,
        lastPostAt: daysAgoIso(r.daysAgo),
      });
      if (replyIndex === 1) {
        for (const reactor of ["market_fan", "collector"]) {
          if (reactor === r.author) continue;
          const reactorId = userIds.get(reactor);
          if (!reactorId) continue;
          await db.orm.public.ForumReaction.create({
            postId: post.id,
            userId: reactorId,
            kind: "LIKE",
          }).catch(() => undefined);
        }
      }
    }

    // FORUM_REPLY notification for the thread author
    await db.orm.public.Notification.create({
      recipientId: authorId,
      type: "FORUM_REPLY",
      title: `Новый ответ в теме «${t.title}»`,
      entityType: "forumThread",
      entityId: thread.id,
      createdAt: daysAgoIso(Math.max(t.daysAgo - 1, 0)),
    }).catch(() => undefined);
  }
  console.log("[seed-plan005] threads seeded");

  // 4. SERVER_NEWS notifications for a few followers
  const publishedNews = await db.orm.public.ServerNews.where({ status: "PUBLISHED" }).limit(3).all();
  for (const n of publishedNews as any[]) {
    const follows = await db.orm.public.ServerFollow.where({ serverId: n.serverId }).all();
    for (const f of follows as any[]) {
      await db.orm.public.Notification.create({
        recipientId: f.userId,
        type: "SERVER_NEWS",
        title: `Новость сервера: ${n.title}`,
        body: n.content.slice(0, 120),
        entityType: "serverNews",
        entityId: n.id,
      }).catch(() => undefined);
    }
  }

  await seedArticles(userIds);
  await seedFollows(userIds);
  await seedResourceViews();

  console.log("[seed-plan005] done");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });