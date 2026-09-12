// PLAN-017 §36: реестр вкладок админ-консоли.
// Существующие id сохранены ровно как в PLAN-002 ("moderation", "sellers",
// "disputes", "versions", "servers", "reports", "community", "articles");
// новые: "overview", "users", "roles", "audit", "logs", "advertising",
// "premium". app/admin/page.tsx рендерит секцию по id из этого реестра (?tab=).
import type { ComponentType } from "react";
import { OverviewSection } from "./overview/OverviewSection";
import { UsersSection } from "./users/UsersSection";
import { RolesSection } from "./roles/RolesSection";
import { AuditSection } from "./audit/AuditSection";
import { LogsSection } from "./logs/LogsSection";
import { AdvertisingSection } from "./advertising/AdvertisingSection";
import { PremiumSection } from "./premium/PremiumSection";
import { ModerationSection } from "./moderation/ModerationSection";
import { SellersSection } from "./sellers/SellersSection";
import { DisputesSection } from "./disputes/DisputesSection";
import { VersionsSection } from "./versions/VersionsSection";
import { AdminServersSection } from "./servers/AdminServersSection";
import { ReportsSection } from "./reports/ReportsSection";
import { CommunityModerationSection } from "./community/CommunityModerationSection";
import { ArticlesModerationSection } from "./articles/ArticlesModerationSection";

export type AdminTabId =
  | "overview"
  | "users"
  | "roles"
  | "audit"
  | "logs"
  | "advertising"
  | "premium"
  | "moderation"
  | "sellers"
  | "disputes"
  | "versions"
  | "servers"
  | "reports"
  | "community"
  | "articles";

export interface AdminTabEntry {
  id: AdminTabId;
  label: string;
  component: ComponentType;
}

export const DEFAULT_ADMIN_TAB: AdminTabId = "overview";

export const TAB_REGISTRY: AdminTabEntry[] = [
  // --- новые секции (PLAN-017 §36) ---
  { id: "overview", label: "Обзор", component: OverviewSection },
  { id: "users", label: "Пользователи", component: UsersSection },
  { id: "roles", label: "Роли и права", component: RolesSection },
  { id: "audit", label: "Аудит", component: AuditSection },
  { id: "logs", label: "Системные журналы", component: LogsSection },
  { id: "advertising", label: "Реклама", component: AdvertisingSection },
  { id: "premium", label: "Premium", component: PremiumSection },
  // --- существующие секции (перенесены из app/admin/page.tsx) ---
  { id: "moderation", label: "Модерация ресурсов", component: ModerationSection },
  { id: "sellers", label: "Продавцы", component: SellersSection },
  { id: "disputes", label: "Споры", component: DisputesSection },
  { id: "versions", label: "Версии", component: VersionsSection },
  { id: "servers", label: "Серверы", component: AdminServersSection },
  { id: "reports", label: "Жалобы", component: ReportsSection },
  { id: "community", label: "Контент сообщества", component: CommunityModerationSection },
  { id: "articles", label: "Статьи", component: ArticlesModerationSection },
];

/** Парсинг ?tab= с валидацией по реестру (неизвестное значение → default). */
export function parseAdminTab(value: string | null | undefined): AdminTabId {
  return TAB_REGISTRY.some((entry) => entry.id === value)
    ? (value as AdminTabId)
    : DEFAULT_ADMIN_TAB;
}