// PLAN-018 Wave-6 frontend finance API client (A-007 payouts, buyer
// transactions, premium subscriptions, deal rooms, beta feedback).
//
// Style: sibling of lib/api/advertising.ts — typed functions over the shared
// fetch `api` from lib/api.ts with defensive readers (the backend may spell
// list envelopes {payouts, total, page, limit} or {data, pagination}; both are
// accepted). Flag-gated surfaces answer 404 { error: "Not found" } when the
// premium flag is off (and the deals router currently answers the same way
// while it has no handlers) — isFeatureDisabledError() lets the surfaces
// degrade honestly instead of crashing.
import api from "../api";

// =====================================================================
// Shared defensive helpers (same posture as lib/api/advertising.ts)
// =====================================================================

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function toCount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function toText(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

interface NormalizedPage<T> {
  rows: T[];
  total: number;
  page: number;
  limit: number;
}

/** Accept both { payouts, total, page, limit } and { data, pagination }. */
function normalizeListPage<T>(raw: unknown, listKeys: string[]): NormalizedPage<T> {
  const obj = asObject(raw);
  const pagination = asObject(obj.pagination);

  let rowsRaw: unknown[] = [];
  for (const key of listKeys) {
    const candidate = obj[key];
    if (Array.isArray(candidate)) {
      rowsRaw = candidate;
      break;
    }
  }

  return {
    rows: rowsRaw as T[],
    total: toCount(obj.total) ?? toCount(pagination.total) ?? rowsRaw.length,
    page: toCount(obj.page) ?? toCount(pagination.page) ?? 1,
    limit: toCount(obj.limit) ?? toCount(pagination.limit) ?? 20,
  };
}

/** 404 { error: "Not found" } = feature flag off / router not landed (honest disabled state). */
export function isFeatureDisabledError(error: unknown): boolean {
  const e = error as { response?: { status?: number; data?: unknown } } | undefined;
  const data = asObject(e?.response?.data);
  return e?.response?.status === 404 && data.error === "Not found";
}

/** Read the structured error code the Wave-6 routes send alongside `error`. */
export function apiErrorCode(error: unknown): string | null {
  const e = error as { response?: { data?: unknown } } | undefined;
  const code = asObject(e?.response?.data).code;
  return typeof code === "string" && code ? code : null;
}

// =====================================================================
// 1. Seller payouts (GET/POST /seller/payouts, GET /seller/payouts/balance)
// =====================================================================

export type PayoutStatus = "PENDING" | "PROCESSING" | "COMPLETED" | "FAILED" | "CANCELLED";

/** Row shape is defensive: every content field may be null/absent. */
export interface Payout {
  id: string;
  amountMinor: number;
  currency: string | null;
  status: string | null;
  note?: string | null;
  decidedAt?: string | null;
  payoutRef?: string | null;
  requestedAt?: string | null;
  [key: string]: unknown;
}

export interface PayoutBalance {
  available: number;
  inEscrow: number;
  currency: string;
}

export interface PayoutsPage {
  payouts: Payout[];
  total: number;
  page: number;
  limit: number;
}

export async function fetchPayoutBalance(): Promise<PayoutBalance> {
  const { data } = await api.get<unknown>("/seller/payouts/balance");
  const obj = asObject(data);
  return {
    available: toCount(obj.available) ?? 0,
    inEscrow: toCount(obj.inEscrow) ?? 0,
    currency: toText(obj.currency) ?? "RUB",
  };
}

export async function fetchMyPayouts(page = 1, limit = 20): Promise<PayoutsPage> {
  const { data } = await api.get<unknown>("/seller/payouts", { params: { page, limit } });
  const normalized = normalizeListPage<unknown>(data, ["payouts", "data"]);
  return {
    payouts: normalized.rows.map((row) => {
      const obj = asObject(row);
      return {
        ...obj,
        id: toText(obj.id) ?? "",
        amountMinor: toCount(obj.amountMinor) ?? 0,
        currency: toText(obj.currency),
        status: toText(obj.status),
      } as Payout;
    }),
    total: normalized.total,
    page: normalized.page,
    limit: normalized.limit,
  };
}

/** POST /seller/payouts → 201 {payout} | 403/409 PayoutError (ru text + code). */
export async function requestPayout(body: { amountMinor: number; note?: string }): Promise<Payout> {
  const { data } = await api.post<unknown>("/seller/payouts", body);
  return asObject(asObject(data).payout) as Payout;
}

// =====================================================================
// 2. GET /payments/transactions/mine — unified buyer money movements
// =====================================================================

export interface TransactionPayment {
  id: string;
  purchaseId?: string | null;
  provider?: string | null;
  amount: number;
  currency?: string | null;
  status?: string | null;
  createdAt?: string | null;
  succeededAt?: string | null;
  [key: string]: unknown;
}

export interface TransactionRefund {
  id: string;
  paymentId?: string | null;
  amount: number;
  currency?: string | null;
  status?: string | null;
  reason?: string | null;
  createdAt?: string | null;
  processedAt?: string | null;
  [key: string]: unknown;
}

export interface TransactionPurchase {
  id: string;
  resourceId?: string | null;
  status?: string | null;
  finalPrice: number;
  createdAt?: string | null;
  completedAt?: string | null;
  [key: string]: unknown;
}

export interface MyTransactions {
  payments: TransactionPayment[];
  refunds: TransactionRefund[];
  purchases: TransactionPurchase[];
  totals: { payments: number; refunds: number; purchases: number };
}

export async function fetchMyTransactions(): Promise<MyTransactions> {
  const { data } = await api.get<unknown>("/payments/transactions/mine");
  const obj = asObject(data);
  const totals = asObject(obj.totals);
  return {
    payments: asArray(obj.payments).map((row) => {
      const p = asObject(row);
      return { ...p, id: toText(p.id) ?? "", amount: toCount(p.amount) ?? 0 } as TransactionPayment;
    }),
    refunds: asArray(obj.refunds).map((row) => {
      const r = asObject(row);
      return { ...r, id: toText(r.id) ?? "", amount: toCount(r.amount) ?? 0 } as TransactionRefund;
    }),
    purchases: asArray(obj.purchases).map((row) => {
      const p = asObject(row);
      return {
        ...p,
        id: toText(p.id) ?? "",
        finalPrice: toCount(p.finalPrice) ?? 0,
      } as TransactionPurchase;
    }),
    totals: {
      payments: toCount(totals.payments) ?? 0,
      refunds: toCount(totals.refunds) ?? 0,
      purchases: toCount(totals.purchases) ?? 0,
    },
  };
}

// =====================================================================
// 3. Premium subscriptions (premium flag — 404 when off; UI stays tolerant)
// =====================================================================

export interface SubscriptionPlan {
  kind?: string | null;
  label?: string | null;
  description?: string | null;
  features?: string[];
  available?: boolean | null;
  enabled?: boolean | null;
  note?: string | null;
  [key: string]: unknown;
}

export interface SubscriptionPlansPage {
  plans: SubscriptionPlan[];
}

export interface Subscription {
  id: string;
  kind?: string | null;
  status?: string | null;
  autoRenew?: boolean | null;
  expiresAt?: string | null;
  createdAt?: string | null;
  [key: string]: unknown;
}

export async function fetchSubscriptionPlans(): Promise<SubscriptionPlansPage> {
  const { data } = await api.get<unknown>("/subscriptions/plans");
  const obj = asObject(data);
  return {
    plans: asArray(obj.plans).map((plan) => {
      const p = asObject(plan);
      return {
        ...p,
        features: asArray(p.features).filter((f): f is string => typeof f === "string"),
      } as SubscriptionPlan;
    }),
  };
}

export async function fetchMySubscriptions(): Promise<Subscription[]> {
  const { data } = await api.get<unknown>("/subscriptions/mine");
  const obj = asObject(data);
  const list = asArray(obj.subscriptions ?? obj.data ?? (Array.isArray(data) ? data : []));
  return list.map((row) => {
    const s = asObject(row);
    return { ...s, id: toText(s.id) ?? "" } as Subscription;
  });
}

export async function createSubscription(plan: string): Promise<unknown> {
  const { data } = await api.post<unknown>("/subscriptions", { plan });
  return data;
}

export async function cancelSubscription(id: string): Promise<unknown> {
  const { data } = await api.post<unknown>(
    `/subscriptions/${encodeURIComponent(id)}/cancel`
  );
  return data;
}

export async function resumeSubscription(id: string): Promise<unknown> {
  const { data } = await api.post<unknown>(
    `/subscriptions/${encodeURIComponent(id)}/resume`
  );
  return data;
}

export async function setSubscriptionAutoRenew(id: string, autoRenew: boolean): Promise<unknown> {
  const { data } = await api.patch<unknown>(
    `/subscriptions/${encodeURIComponent(id)}/auto-renew`,
    { autoRenew }
  );
  return data;
}

// =====================================================================
// 4. Deal rooms (protected transaction workspace)
// =====================================================================

export type DealRole = "buyer" | "seller";

export type DealTransitionAction =
  | "mark_funded"
  | "start_delivery"
  | "mark_delivered"
  | "accept"
  | "open_dispute"
  | "resolve"
  | "close";

export interface DealCounterparty {
  id?: string | null;
  username?: string | null;
  displayName?: string | null;
  [key: string]: unknown;
}

export interface DealSummary {
  id: string;
  title?: string | null;
  amountMinor: number;
  currency?: string | null;
  status?: string | null;
  counterparty?: DealCounterparty | null;
  createdAt?: string | null;
  [key: string]: unknown;
}

export interface DealParty {
  userId?: string | null;
  role?: string | null;
  username?: string | null;
  displayName?: string | null;
  [key: string]: unknown;
}

export interface DealRoom extends DealSummary {
  parties: DealParty[];
  buyerId?: string | null;
  sellerId?: string | null;
  orderId?: string | null;
  disputeId?: string | null;
}

export interface DealsQuery {
  role?: DealRole;
  status?: string;
}

export interface DealsPage {
  deals: DealSummary[];
  total: number;
  page: number;
  limit: number;
}

export async function fetchDeals(query: DealsQuery = {}): Promise<DealsPage> {
  const { data } = await api.get<unknown>("/deals", {
    params: {
      ...(query.role ? { role: query.role } : {}),
      ...(query.status ? { status: query.status } : {}),
    },
  });
  const normalized = normalizeListPage<unknown>(data, ["deals", "data"]);
  return {
    deals: normalized.rows.map((row) => normalizeDealSummary(row)),
    total: normalized.total,
    page: normalized.page,
    limit: normalized.limit,
  };
}

function normalizeDealSummary(raw: unknown): DealSummary {
  const obj = asObject(raw);
  const counterparty = asObject(obj.counterparty);
  return {
    ...obj,
    id: toText(obj.id) ?? "",
    title: toText(obj.title),
    amountMinor: toCount(obj.amountMinor) ?? 0,
    currency: toText(obj.currency),
    status: toText(obj.status),
    counterparty: Object.keys(counterparty).length ? (counterparty as DealCounterparty) : null,
    createdAt: toText(obj.createdAt),
  };
}

export async function fetchDeal(id: string): Promise<DealRoom> {
  const { data } = await api.get<unknown>(`/deals/${encodeURIComponent(id)}`);
  // Contract: room + parties. Accept both { deal: {...}, parties } and the
  // flat room payload.
  const obj = asObject(data);
  const dealObj = asObject(obj.deal);
  const room = Object.keys(dealObj).length ? { ...obj, ...dealObj } : obj;
  const parties = asArray(room.parties).map((party) => asObject(party) as DealParty);
  return { ...normalizeDealSummary(room), parties } as DealRoom;
}

export interface CreateDealInput {
  counterpartyId: string;
  subjectType?: string;
  subjectId?: string;
  title: string;
  amountMinor: number;
}

/** POST /deals → the created room. */
export async function createDeal(input: CreateDealInput): Promise<DealRoom> {
  const { data } = await api.post<unknown>("/deals", input);
  const obj = asObject(data);
  const room = asObject(obj.deal).id ? obj : data; // { deal } | room
  const parties = asArray(asObject(room).parties).map((p) => asObject(p) as DealParty);
  return { ...normalizeDealSummary(room), parties } as DealRoom;
}

export interface DealTransitionInput {
  action: DealTransitionAction;
  reason?: string;
  note?: string;
  orderId?: string;
  disputeId?: string;
}

export async function transitionDeal(
  id: string,
  input: DealTransitionInput
): Promise<unknown> {
  const { data } = await api.post<unknown>(
    `/deals/${encodeURIComponent(id)}/transition`,
    input
  );
  return data;
}

export interface DealMessage {
  id: string;
  body: string;
  createdAt?: string | null;
  authorId?: string | null;
  [key: string]: unknown;
}

export async function fetchDealMessages(id: string): Promise<DealMessage[]> {
  const { data } = await api.get<unknown>(
    `/deals/${encodeURIComponent(id)}/messages`
  );
  const obj = asObject(data);
  const list = asArray(obj.messages ?? (Array.isArray(data) ? data : []));
  return list.map((row) => {
    const m = asObject(row);
    return {
      ...m,
      id: toText(m.id) ?? "",
      body: toText(m.body) ?? "",
    } as DealMessage;
  });
}

export async function postDealMessage(id: string, body: string): Promise<unknown> {
  const { data } = await api.post<unknown>(
    `/deals/${encodeURIComponent(id)}/messages`,
    { body }
  );
  return data;
}

export type DealEvidenceKind = "MESSAGE" | "FILE" | "DELIVERY" | "DISPUTE_EVENT";

export interface DealEvidence {
  id: string;
  kind?: string | null;
  url?: string | null;
  body?: string | null;
  createdAt?: string | null;
  authorId?: string | null;
  [key: string]: unknown;
}

export async function fetchDealEvidence(id: string): Promise<DealEvidence[]> {
  const { data } = await api.get<unknown>(`/deals/${encodeURIComponent(id)}/evidence`);
  const obj = asObject(data);
  const list = asArray(obj.evidence ?? (Array.isArray(data) ? data : []));
  return list.map((row) => {
    const e = asObject(row);
    return { ...e, id: toText(e.id) ?? "" } as DealEvidence;
  });
}

export interface DealEvidenceInput {
  kind: string;
  url?: string;
  body?: string;
}

export async function postDealEvidence(
  id: string,
  input: DealEvidenceInput
): Promise<unknown> {
  const { data } = await api.post<unknown>(
    `/deals/${encodeURIComponent(id)}/evidence`,
    input
  );
  return data;
}

// =====================================================================
// 5. Feedback (controlled beta): POST /feedback
// =====================================================================

export type FeedbackCategory = "BUG" | "UX" | "BILLING" | "CONTENT" | "OTHER";
export type FeedbackSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface FeedbackInput {
  category: FeedbackCategory;
  severity: FeedbackSeverity;
  description: string;
  route?: string;
  screenshotUrl?: string;
}

/** POST /feedback → 201 {id, status, category, severity}. */
export async function submitFeedback(input: FeedbackInput): Promise<{
  id: string;
  status?: string | null;
  category?: string | null;
  severity?: string | null;
}> {
  const { data } = await api.post<unknown>("/feedback", input);
  const obj = asObject(data);
  return {
    id: toText(obj.id) ?? "",
    status: toText(obj.status),
    category: toText(obj.category),
    severity: toText(obj.severity),
  };
}