// PLAN-019 E-003: commerce domain API (split from lib/api-ext.ts).
// Purchases / payments / services / disputes / seller profile + analytics,
// plus the legacy admin seller + dispute endpoints consumed through the
// lib/api/admin.ts façade. (Provider discovery stays in lib/api/payments.ts.)
import api from "../api";
import type { Paginated } from "@mta-market/shared";

// ---------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------
export interface Purchase {
  id: string;
  status: string;
  priceSnapshot: number;
  createdAt: string;
  resource: { slug: string; title: string; type: string };
  version?: { version: string } | null;
  license?: { id: string; status: string } | null;
}

export interface Service {
  id: string;
  slug: string;
  title: string;
  description: string;
  type: string;
  price: number;
  deliveryDays: number;
  requirements?: string | null;
}

export interface ServiceOrder {
  id: string;
  status: string;
  finalPrice: number;
  createdAt: string;
  buyerNotes?: string | null;
  service: { slug: string; title: string };
}

export interface Dispute {
  id: string;
  targetType: string;
  status: string;
  reason: string;
  resolution?: string | null;
  createdAt: string;
}

export interface SellerProfile {
  id: string;
  userId: string;
  status: string;
  displayName?: string | null;
  supportInfo?: string | null;
}

export interface SellerAnalytics {
  days: number;
  totalViews: number;
  totalPurchases: number;
  byResource: {
    resourceId: string;
    slug: string;
    title: string;
    views30d: number;
    purchases30d: number;
    conversionPct: number | null;
  }[];
}

// ---------------------------------------------------------------------
// Purchases / payments
// ---------------------------------------------------------------------

export async function createPurchase(resourceSlug: string, discountCode?: string) {
  const { data } = await api.post<
    | {
        status: "completed";
        purchaseId: string;
        licenseId: string;
        orderId: string;
      }
    | {
        status: "pending";
        purchaseId: string;
        amount: number;
        originalAmount: number;
        discount?: { amount: number; percentage: number };
      }
  >("/purchases", discountCode ? { resourceSlug, discountCode } : { resourceSlug });
  return data;
}

export async function createPayment(purchaseId: string, provider?: string) {
  const { data } = await api.post<{
    paymentUrl?: string;
    paymentId?: string;
    provider?: string;
    confirmation?: {
      type: "redirect" | "crypto_invoice";
      redirectUrl?: string;
      payUrl?: string;
      address?: string;
      memo?: string;
      expiresAt?: string;
    } | null;
    message?: string;
  }>("/payments/create", provider ? { purchaseId, provider } : { purchaseId });
  return data;
}

export async function fetchMyPurchases() {
  const { data } = await api.get<Purchase[]>("/purchases/my");
  return data;
}

// ---------------------------------------------------------------------
// Seller profile + analytics
// ---------------------------------------------------------------------

/**
 * GET /seller/profile — the server wraps the row: { profile: SellerProfile | null }.
 * Returns the unwrapped profile (null when the user has not applied yet).
 */
export async function fetchSellerProfile(): Promise<SellerProfile | null> {
  const { data } = await api.get<{ profile: SellerProfile | null }>("/seller/profile");
  return data.profile ?? null;
}

export async function applySeller(body: { displayName?: string; supportInfo?: string }) {
  const { data } = await api.post<SellerProfile>("/seller/apply", body);
  return data;
}

export async function fetchSellerAnalytics(): Promise<SellerAnalytics> {
  const { data } = await api.get("/seller/analytics");
  return data;
}

// ---------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------

export async function fetchServices() {
  const { data } = await api.get<{ data: Service[] }>("/services");
  return data.data;
}

export async function fetchService(slug: string) {
  const { data } = await api.get<Service>(`/services/${slug}`);
  return data;
}

export async function fetchMyServices() {
  const { data } = await api.get<{ data: Service[] } | Service[]>("/services/my");
  return Array.isArray(data) ? data : data.data;
}

export async function createService(body: {
  title: string;
  description: string;
  type: string;
  price: number;
  deliveryDays: number;
  requirements?: string;
}) {
  const { data } = await api.post<Service>("/services", body);
  return data;
}

export async function orderService(slug: string, buyerNotes?: string) {
  const { data } = await api.post<{ servicePurchaseId: string; status: string; finalPrice: number }>(
    `/services/${slug}/order`,
    buyerNotes ? { buyerNotes } : {}
  );
  return data;
}

export async function fetchMyServiceOrders() {
  const { data } = await api.get<Paginated<ServiceOrder>>("/services/orders/my");
  return data;
}

export async function serviceOrderAction(id: string, action: string, body?: Record<string, unknown>) {
  const { data } = await api.post(`/services/orders/${id}/${action}`, body ?? {});
  return data;
}

export async function postServiceOrderMessage(id: string, body: string) {
  const { data } = await api.post(`/services/orders/${id}/messages`, { body });
  return data;
}

// ---------------------------------------------------------------------
// Disputes
// ---------------------------------------------------------------------

export async function createDispute(body: {
  targetType: "PURCHASE" | "SERVICE_PURCHASE";
  purchaseId?: string;
  servicePurchaseId?: string;
  reason: string;
}) {
  const { data } = await api.post<Dispute>("/disputes", body);
  return data;
}

export async function fetchMyDisputes() {
  const { data } = await api.get<Paginated<Dispute>>("/disputes/my");
  return data;
}

export async function fetchDispute(id: string) {
  const { data } = await api.get<{
    dispute: Dispute;
    messages: { id: string; body: string; createdAt: string; authorId?: string }[];
  }>(`/disputes/${id}`);
  return data;
}

export async function postDisputeMessage(id: string, body: string) {
  const { data } = await api.post(`/disputes/${id}/messages`, { body });
  return data;
}

// ---------------------------------------------------------------------
// Legacy admin sellers / disputes (source of truth for the
// lib/api/admin.ts façade).
// ---------------------------------------------------------------------

export async function fetchAdminSellers(status?: string) {
  const { data } = await api.get<{ data: SellerProfile[]; total: number }>("/seller/list", {
    params: status ? { status } : {},
  });
  return data;
}

/** Server contract: POST /seller/:userId/approve | /seller/:userId/reject. */
export async function adminSellerAction(userId: string, action: "approve" | "reject", reason?: string) {
  const { data } = await api.post(`/seller/${userId}/${action}`, action === "reject" ? { reason: reason ?? "Отклонено" } : {});
  return data;
}

/** Admin dispute list lives at GET /disputes/admin/all (ADMIN only). */
export async function fetchAdminDisputes(status?: string) {
  const { data } = await api.get<Paginated<Dispute>>("/disputes/admin/all", {
    params: status ? { status } : {},
  });
  return data;
}

export async function adminTransitionDispute(id: string, status: string, resolution?: string) {
  const { data } = await api.post(`/admin/disputes/${id}/transition`, resolution ? { status, resolution } : { status });
  return data;
}