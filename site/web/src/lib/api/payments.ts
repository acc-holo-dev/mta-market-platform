// PLAN-016 D-008: payments domain API (provider discovery + checkout).
// Доменные модули lib/api/* реэкспортируются из lib/api-ext.ts — импорты
// по всему app не ломаются.
import api from "../api";

/** GET /payments/providers — public discovery of enabled payment providers. */
export interface PaymentProviderInfo {
  provider: string;
  displayName: string;
  confirmation: "redirect" | "crypto_invoice";
}

export async function fetchPaymentProviders(): Promise<PaymentProviderInfo[]> {
  const { data } = await api.get<{ providers: PaymentProviderInfo[] }>("/payments/providers");
  return data.providers;
}