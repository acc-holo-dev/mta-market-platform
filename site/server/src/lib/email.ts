// Email notification system (nodemailer)
import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { logger } from "./logger.js";
import { incEmailFailure } from "./metrics.js";

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
    subject: "Р”РѕР±СЂРѕ РїРѕР¶Р°Р»РѕРІР°С‚СЊ РІ MTA Market!",
    html: `
      <h1>РџСЂРёРІРµС‚, ${username}!</h1>
      <p>Р”РѕР±СЂРѕ РїРѕР¶Р°Р»РѕРІР°С‚СЊ РІ MTA Market вЂ” РјР°СЂРєРµС‚РїР»РµР№СЃ РґР»СЏ MTA:SA СЂРµСЃСѓСЂСЃРѕРІ.</p>
      <p>РўРµРїРµСЂСЊ РІС‹ РјРѕР¶РµС‚Рµ:</p>
      <ul>
        <li>РџРѕРєСѓРїР°С‚СЊ РіРѕС‚РѕРІС‹Рµ СЃРєСЂРёРїС‚С‹ Рё РјРѕРґС‹</li>
        <li>РџСЂРѕРґР°РІР°С‚СЊ СЃРІРѕРё СЂР°Р·СЂР°Р±РѕС‚РєРё</li>
        <li>РћСЃС‚Р°РІР»СЏС‚СЊ РѕС‚Р·С‹РІС‹</li>
      </ul>
      <p>РЈРґР°С‡Рё!</p>
    `,
    text: `РџСЂРёРІРµС‚, ${username}! Р”РѕР±СЂРѕ РїРѕР¶Р°Р»РѕРІР°С‚СЊ РІ MTA Market.`,
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
    subject: `РџРѕРєСѓРїРєР° Р·Р°РІРµСЂС€РµРЅР°: ${resourceTitle}`,
    html: `
      <h1>РџРѕРєСѓРїРєР° Р·Р°РІРµСЂС€РµРЅР°!</h1>
      <p>Р’С‹ СѓСЃРїРµС€РЅРѕ РїСЂРёРѕР±СЂРµР»Рё: <strong>${resourceTitle}</strong></p>
      <p>ID Р»РёС†РµРЅР·РёРё: <code>${licenseId}</code></p>
      <p>РЎРєР°С‡Р°С‚СЊ СЂРµСЃСѓСЂСЃ РјРѕР¶РЅРѕ РІ Р»РёС‡РЅРѕРј РєР°Р±РёРЅРµС‚Рµ.</p>
      <p><a href="${process.env.FRONTEND_URL}/dashboard/purchases">РџРµСЂРµР№С‚Рё Рє РїРѕРєСѓРїРєР°Рј</a></p>
    `,
    text: `РџРѕРєСѓРїРєР° Р·Р°РІРµСЂС€РµРЅР°: ${resourceTitle}. ID Р»РёС†РµРЅР·РёРё: ${licenseId}`,
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
    subject: `РќРѕРІС‹Р№ РѕС‚Р·С‹РІ РЅР° "${resourceTitle}"`,
    html: `
      <h1>РќРѕРІС‹Р№ РѕС‚Р·С‹РІ!</h1>
      <p>РџРѕР»СЊР·РѕРІР°С‚РµР»СЊ РѕСЃС‚Р°РІРёР» РѕС‚Р·С‹РІ РЅР° РІР°С€ СЂРµСЃСѓСЂСЃ: <strong>${resourceTitle}</strong></p>
      <p>РћС†РµРЅРєР°: ${"в­ђ".repeat(rating)}</p>
      <p><a href="${process.env.FRONTEND_URL}/resources/${resourceTitle}">РџРѕСЃРјРѕС‚СЂРµС‚СЊ РѕС‚Р·С‹РІС‹</a></p>
    `,
    text: `РќРѕРІС‹Р№ РѕС‚Р·С‹РІ РЅР° "${resourceTitle}". РћС†РµРЅРєР°: ${rating}/5`,
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
    subject: `Р РµСЃСѓСЂСЃ "${resourceTitle}" РѕРїСѓР±Р»РёРєРѕРІР°РЅ`,
    html: `
      <h1>Р РµСЃСѓСЂСЃ РѕРїСѓР±Р»РёРєРѕРІР°РЅ!</h1>
      <p>Р’Р°С€ СЂРµСЃСѓСЂСЃ <strong>${resourceTitle}</strong> РїСЂРѕС€С‘Р» РјРѕРґРµСЂР°С†РёСЋ Рё РѕРїСѓР±Р»РёРєРѕРІР°РЅ.</p>
      <p><a href="${process.env.FRONTEND_URL}/resources/${slug}">РџРѕСЃРјРѕС‚СЂРµС‚СЊ РЅР° СЃР°Р№С‚Рµ</a></p>
      <p>РўРµРїРµСЂСЊ РїРѕР»СЊР·РѕРІР°С‚РµР»Рё РјРѕРіСѓС‚ РµРіРѕ РїРѕРєСѓРїР°С‚СЊ.</p>
    `,
    text: `Р РµСЃСѓСЂСЃ "${resourceTitle}" РѕРїСѓР±Р»РёРєРѕРІР°РЅ.`,
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
    subject: `Р›РёС†РµРЅР·РёСЏ Р°РєС‚РёРІРёСЂРѕРІР°РЅР° РЅР° СЃРµСЂРІРµСЂРµ "${serverName}"`,
    html: `
      <h1>Р›РёС†РµРЅР·РёСЏ Р°РєС‚РёРІРёСЂРѕРІР°РЅР°!</h1>
      <p>Р’Р°С€Р° Р»РёС†РµРЅР·РёСЏ РЅР° <strong>${resourceTitle}</strong> Р°РєС‚РёРІРёСЂРѕРІР°РЅР°.</p>
      <p>РЎРµСЂРІРµСЂ: <strong>${serverName}</strong></p>
      <p>Р•СЃР»Рё СЌС‚Рѕ Р±С‹Р»Рё РЅРµ РІС‹, РѕР±СЂР°С‚РёС‚РµСЃСЊ РІ РїРѕРґРґРµСЂР¶РєСѓ.</p>
    `,
    text: `Р›РёС†РµРЅР·РёСЏ РЅР° "${resourceTitle}" Р°РєС‚РёРІРёСЂРѕРІР°РЅР° РЅР° СЃРµСЂРІРµСЂРµ "${serverName}".`,
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
    subject: `Р’С‹РїР»Р°С‚Р° ${amountFormatted} ${currency} РѕР±СЂР°Р±РѕС‚Р°РЅР°`,
    html: `
      <h1>Р’С‹РїР»Р°С‚Р° РѕР±СЂР°Р±РѕС‚Р°РЅР°!</h1>
      <p>РЎСѓРјРјР°: <strong>${amountFormatted} ${currency}</strong></p>
      <p>РЎСЂРµРґСЃС‚РІР° Р±СѓРґСѓС‚ Р·Р°С‡РёСЃР»РµРЅС‹ РІ С‚РµС‡РµРЅРёРµ 1-3 СЂР°Р±РѕС‡РёС… РґРЅРµР№.</p>
      <p><a href="${process.env.FRONTEND_URL}/dashboard/balance">РџРѕСЃРјРѕС‚СЂРµС‚СЊ Р±Р°Р»Р°РЅСЃ</a></p>
    `,
    text: `Р’С‹РїР»Р°С‚Р° ${amountFormatted} ${currency} РѕР±СЂР°Р±РѕС‚Р°РЅР°.`,
  });
}

export { EMAIL_ENABLED };
