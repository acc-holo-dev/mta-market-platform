// Email notification system (nodemailer)
import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { logger } from "./logger";
import { incEmailFailure } from "./metrics";

const EMAIL_ENABLED = process.env.EMAIL_ENABLED === "true";
const SMTP_HOST = process.env.SMTP_HOST || "smtp.gmail.com";
const SMTP_PORT = parseInt(process.env.SMTP_PORT || "587", 10);
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const EMAIL_FROM = process.env.EMAIL_FROM || "noreply@mtamarket.com";

let transporter: Transporter | null = null;

if (EMAIL_ENABLED) {
  transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT,
    secure: SMTP_PORT === 465,
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
  });
}

export interface SendEmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export async function sendEmail(options: SendEmailOptions): Promise<void> {
  if (!EMAIL_ENABLED || !transporter) {
    logger.info("email_send_skipped_disabled", { subject: options.subject, recipient: options.to });
    return;
  }

  try {
    await transporter.sendMail({
      from: EMAIL_FROM,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text || "",
    });

    logger.info("email_sent", { subject: options.subject, recipient: options.to });
  } catch (error) {
    incEmailFailure();
    logger.error("email_send_failed", { recipient: options.to, error });
    throw error;
  }
}

// Template: Welcome email
export async function sendWelcomeEmail(email: string, username: string): Promise<void> {
  await sendEmail({
    to: email,
    subject: "Добро пожаловать в MTA Market!",
    html: `
      <h1>Привет, ${username}!</h1>
      <p>Добро пожаловать в MTA Market — маркетплейс для MTA:SA ресурсов.</p>
      <p>Теперь вы можете:</p>
      <ul>
        <li>Покупать готовые скрипты и моды</li>
        <li>Продавать свои разработки</li>
        <li>Оставлять отзывы</li>
      </ul>
      <p>Удачи!</p>
    `,
    text: `Привет, ${username}! Добро пожаловать в MTA Market.`,
  });
}

// Template: Purchase completed
export async function sendPurchaseEmail(
  email: string,
  resourceTitle: string,
  licenseId: string
): Promise<void> {
  await sendEmail({
    to: email,
    subject: `Покупка завершена: ${resourceTitle}`,
    html: `
      <h1>Покупка завершена!</h1>
      <p>Вы успешно приобрели: <strong>${resourceTitle}</strong></p>
      <p>ID лицензии: <code>${licenseId}</code></p>
      <p>Скачать ресурс можно в личном кабинете.</p>
      <p><a href="${process.env.FRONTEND_URL}/dashboard/purchases">Перейти к покупкам</a></p>
    `,
    text: `Покупка завершена: ${resourceTitle}. ID лицензии: ${licenseId}`,
  });
}

// Template: New review notification
export async function sendReviewNotification(
  email: string,
  resourceTitle: string,
  rating: number
): Promise<void> {
  await sendEmail({
    to: email,
    subject: `Новый отзыв на "${resourceTitle}"`,
    html: `
      <h1>Новый отзыв!</h1>
      <p>Пользователь оставил отзыв на ваш ресурс: <strong>${resourceTitle}</strong></p>
      <p>Оценка: ${"⭐".repeat(rating)}</p>
      <p><a href="${process.env.FRONTEND_URL}/resources/${resourceTitle}">Посмотреть отзывы</a></p>
    `,
    text: `Новый отзыв на "${resourceTitle}". Оценка: ${rating}/5`,
  });
}

// Template: Resource published
export async function sendResourcePublishedEmail(
  email: string,
  resourceTitle: string,
  slug: string
): Promise<void> {
  await sendEmail({
    to: email,
    subject: `Ресурс "${resourceTitle}" опубликован`,
    html: `
      <h1>Ресурс опубликован!</h1>
      <p>Ваш ресурс <strong>${resourceTitle}</strong> прошёл модерацию и опубликован.</p>
      <p><a href="${process.env.FRONTEND_URL}/resources/${slug}">Посмотреть на сайте</a></p>
      <p>Теперь пользователи могут его покупать.</p>
    `,
    text: `Ресурс "${resourceTitle}" опубликован.`,
  });
}

// Template: License activated
export async function sendLicenseActivatedEmail(
  email: string,
  resourceTitle: string,
  serverName: string
): Promise<void> {
  await sendEmail({
    to: email,
    subject: `Лицензия активирована на сервере "${serverName}"`,
    html: `
      <h1>Лицензия активирована!</h1>
      <p>Ваша лицензия на <strong>${resourceTitle}</strong> активирована.</p>
      <p>Сервер: <strong>${serverName}</strong></p>
      <p>Если это были не вы, обратитесь в поддержку.</p>
    `,
    text: `Лицензия на "${resourceTitle}" активирована на сервере "${serverName}".`,
  });
}

// Template: Payout completed
export async function sendPayoutEmail(
  email: string,
  amount: number,
  currency: string
): Promise<void> {
  const amountFormatted = (amount / 100).toFixed(2);

  await sendEmail({
    to: email,
    subject: `Выплата ${amountFormatted} ${currency} обработана`,
    html: `
      <h1>Выплата обработана!</h1>
      <p>Сумма: <strong>${amountFormatted} ${currency}</strong></p>
      <p>Средства будут зачислены в течение 1-3 рабочих дней.</p>
      <p><a href="${process.env.FRONTEND_URL}/dashboard/balance">Посмотреть баланс</a></p>
    `,
    text: `Выплата ${amountFormatted} ${currency} обработана.`,
  });
}

export { EMAIL_ENABLED };
