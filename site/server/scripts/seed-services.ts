// Development seed — каталог услуг (PLAN C-009/C-015 «Услуги»).
//
// Заполняет раздел «Услуги» (вкладка на /resources?tab=services и страницы
// /services/[slug]): идемпотентно по slug создаёт PUBLISHED услуги всех
// типов ServiceType у существующих seed-продавцов (APPROVED SellerProfile
// из seed-plan003) + одну DRAFT-услугу для проверки кабинета продавца.
// Заказы услуг намеренно не создаются: денежный контур (Order/Ledger)
// остаётся чистым, инварианты settlement не затрагиваются.
//
// Требует, чтобы пользователи-продавцы существовали (seed-plan003.ts);
// отсутствующий APPROVED-профиль продавца доздаётся на месте.
//
// Запуск: pnpm --filter @mta-market/server exec tsx scripts/seed-services.ts
import "dotenv/config";
import bcrypt from "bcryptjs";
import { db } from "../src/prisma/db";

const PASSWORD = "seed-password-123";

interface SeedService {
  slug: string;
  seller: string;
  title: string;
  description: string;
  type: "CUSTOM_DEVELOPMENT" | "CONFIGURATION" | "SUPPORT" | "CONSULTATION" | "OTHER";
  price: number; // kopecks
  deliveryDays: number;
  requirements: string;
  draft?: boolean;
}

const SERVICES: SeedService[] = [
  {
    slug: "custom-hud-interfaces",
    seller: "nightforge",
    title: "Кастомный HUD и интерфейсы под ваш сервер",
    description:
      "Разработка интерфейсов под стиль вашего проекта: HUD, меню, инвентарь, магазины, спидометры. Дизайн-макет согласуется до начала работ, в конце — исходники с конфигом и инструкцией по подключению. Две итерации правок включены.",
    type: "CUSTOM_DEVELOPMENT",
    price: 45000,
    deliveryDays: 7,
    requirements:
      "Скриншоты или референсы желаемого вида, список нужных виджетов, тестовый сервер для отладки. ТЗ в свободной форме — помогут его сформулировать.",
  },
  {
    slug: "race-system-tournament-setup",
    seller: "nightforge",
    title: "Настройка Race System под турниры",
    description:
      "Установка и настройка гоночной системы: импорт ваших трасс, контрольные точки, зачёт команд, таблица сезонов и экспорт результатов. Оставляю сервер с рабочим турнирным контуром и памяткой администратора.",
    type: "CONFIGURATION",
    price: 25000,
    deliveryDays: 3,
    requirements:
      "Доступ к серверу (панель или FTP), список трасс и режимов, которые планируете использовать.",
  },
  {
    slug: "lua-performance-audit",
    seller: "nightforge",
    title: "Аудит производительности Lua-ресурсов",
    description:
      "Профилирование серверной и клиентской части: горячие таймеры, синхронные запросы к БД, утечки в onClientRender. На выходе — отчёт с приоритезированным списком проблем и конкретными патчами для топ-3 узких мест.",
    type: "CONSULTATION",
    price: 12000,
    deliveryDays: 2,
    requirements:
      "Доступ к исходникам ресурсов или выгрузка профилировщика, описание симптомов (лаги, фризы, рост памяти).",
  },
  {
    slug: "rp-server-turnkey",
    seller: "dunedragons",
    title: "RP-сервер под ключ: каркас и запуск",
    description:
      "Полный цикл запуска ролевого сервера: установка каркаса (аккаунты, персонажи, инвентарь, экономика), настройка фракций и работ, наполнение стартовым контентом, проверка под нагрузкой. Передаю проект с документацией и планом развития.",
    type: "CUSTOM_DEVELOPMENT",
    price: 150000,
    deliveryDays: 14,
    requirements:
      "Концепция сервера (жанр, сеттинг, список систем), VPS или выделенный хостинг, домен при наличии.",
  },
  {
    slug: "map-optimization-200-players",
    seller: "dunedragons",
    title: "Оптимизация карты под 200+ игроков",
    description:
      "Аудит карты: коллизии, LOD, стриминг объектов, свет и партиклы. Убираю лишнюю геометрию, разбиваю тяжёлые зоны, выравниваю производительность под большие онлайны. Отчёт «до/после» с замерами FPS.",
    type: "CONFIGURATION",
    price: 30000,
    deliveryDays: 5,
    requirements:
      "Файлы карты (или доступ к репозиторию ресурса), целевой онлайн и железо сервера.",
  },
  {
    slug: "server-support-month",
    seller: "dunedragons",
    title: "Техническое сопровождение сервера (месяц)",
    description:
      "Абонентский пакет: мониторинг стабильности, мелкие правки скриптов, обновления ресурсов, помощь игрокам с багами репорта. Реакция на критические проблемы — в течение суток, еженедельный отчёт о проделанной работе.",
    type: "SUPPORT",
    price: 20000,
    deliveryDays: 30,
    requirements:
      "Доступ к серверу и репозиторию ресурсов, список приоритетных зон внимания на месяц.",
  },
  {
    slug: "faction-skins-pack",
    seller: "pixelera",
    title: "Пакет скинов и униформы для фракций",
    description:
      "Отрисовка кастомных скинов под ваши фракции: полиция, банды, медики, механики. Единый стиль, до 10 вариантов на фракцию, корректные LOD и посадка на стандартный скелет MTA. Итог — пакет, готовый к импорту.",
    type: "CUSTOM_DEVELOPMENT",
    price: 60000,
    deliveryDays: 10,
    requirements:
      "Список фракций и рангов, референсы по стилю (реализм/стилизация), пожелания по цветам и шевронам.",
  },
  {
    slug: "texture-pack-integration",
    seller: "pixelera",
    title: "Подключение и настройка текстур-паков",
    description:
      "Интеграция купленных на маркете текстур-паков в ваш сервер: замена стандартных материалов, настройка emissive-слоёв, проверка на отсутствие конфликтов между паками и маппингом.",
    type: "CONFIGURATION",
    price: 15000,
    deliveryDays: 2,
    requirements:
      "Список установленных текстур-паков и активных карт, доступ к ресурсам сервера.",
  },
  {
    slug: "content-migration",
    seller: "pixelera",
    title: "Перенос контента со старого сервера",
    description:
      "Миграция контента с прежнего проекта: модели, текстуры, скрипты и конфиги переносятся в актуальную структуру, правятся зависимости и пути, прогоняется проверка целостности. Подходит при переезде на новый каркас.",
    type: "OTHER",
    price: 40000,
    deliveryDays: 5,
    requirements:
      "Архив старого сервера (или доступ к нему), описание целевой структуры, список того, что переносить не нужно.",
  },
  {
    slug: "server-sound-design",
    seller: "soundsmith",
    title: "Звуковой дизайн и радио-джинглы сервера",
    description:
      "Комплект звука для сервера: джинглы радио, сигнатурные звуки интерфейса, атмосферные петли для районов карты. Всё сведено под внутриигровое воспроизведение, метаданные и лицензия чисты.",
    type: "CUSTOM_DEVELOPMENT",
    price: 35000,
    deliveryDays: 6,
    requirements:
      "Референсы по настроению (направление музыки/звука), список сценариев использования звука.",
  },
  {
    slug: "audio-consultation",
    seller: "soundsmith",
    title: "Консультация по аудио на сервере",
    description:
      "Часовая консультация: как организовать радио и звуковые пресеты без просадок, какие форматы и битрейты выбрать, как выстроить очередь плейлистов. Разбор вашей текущей схемы и список конкретных шагов.",
    type: "CONSULTATION",
    price: 8000,
    deliveryDays: 1,
    requirements:
      "Описание текущей аудио-схемы (что и как играет), список вопросов заранее — ответ будет готов к созвону.",
  },
  {
    slug: "arena-minigames-pack",
    seller: "dunedragons",
    title: "Арены мини-игр на заказ",
    description:
      "Черновик услуги: проектирование и сборка арен под мини-игры (дерби, паркур, last-man-standing) в едином визуальном стиле. Публикуется после утверждения шаблона арены.",
    type: "CUSTOM_DEVELOPMENT",
    price: 55000,
    deliveryDays: 12,
    requirements:
      "Список желаемых мини-игр, размер онлайна на арену, стиль оформления.",
    draft: true,
  },
];

const SELLER_FALLBACK_SUPPORT = "Скрипты и интерфейсы. Поддержка в Discord, обновления бесплатные.";

async function ensureSeller(username: string): Promise<string> {
  let user = await db.orm.public.User.where({ username }).first();
  if (!user) {
    const passwordHash = await bcrypt.hash(PASSWORD, 10);
    user = await db.orm.public.User.create({
      email: `${username}@mtamarket.dev`,
      username,
      displayName: username,
      passwordHash,
      role: "USER",
      status: "ACTIVE",
    });
  }
  const profile = await db.orm.public.SellerProfile.where({ userId: user.id }).first();
  if (!profile) {
    await db.orm.public.SellerProfile.create({
      userId: user.id,
      status: "APPROVED",
      displayName: user.displayName || username,
      supportInfo: SELLER_FALLBACK_SUPPORT,
      payoutEnabled: true,
    });
  }
  return user.id;
}

async function main() {
  let created = 0;
  for (const s of SERVICES) {
    const existing = await db.orm.public.Service.where({ slug: s.slug }).first();
    if (existing) {
      console.log(`= пропущен (уже есть): ${s.slug}`);
      continue;
    }
    const sellerId = await ensureSeller(s.seller);
    await db.orm.public.Service.create({
      sellerId,
      slug: s.slug,
      title: s.title,
      description: s.description,
      type: s.type,
      status: s.draft ? "DRAFT" : "PUBLISHED",
      price: s.price,
      deliveryDays: s.deliveryDays,
      requirements: s.requirements,
    });
    created += 1;
    console.log(`+ услуга: ${s.slug} (${s.type}, ${Math.round(s.price / 100)} RUB${s.draft ? ", draft" : ""})`);
  }
  console.log(`Seed услуг завершён: создано ${created}, всего в датасете ${SERVICES.length}.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  });
