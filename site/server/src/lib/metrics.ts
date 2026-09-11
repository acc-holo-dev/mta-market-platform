// PLAN O-001: minimal Prometheus text-format metrics registry.
// Dependency-free: counters and histograms (as count/sum/max buckets) kept
// in process memory. The plan's metric set:
//   http_requests_total, http_5xx_total, http_latency,
//   db_latency, redis_latency, payment_webhook_lag, payment_success_rate,
//   license_verify_failures, sandbox_failures, download_failures,
//   email_failures.
// Structured logs remain the durable record; these series exist for scraping.

type LabelMap = Record<string, string | number>;

interface CounterSeries {
  help: string;
  values: Map<string, number>; // labelKey -> value
}

interface HistogramSeries {
  help: string;
  count: number;
  sum: number;
  max: number;
}

function labelKey(labels: LabelMap): string {
  const keys = Object.keys(labels).sort();
  if (keys.length === 0) return "";
  return keys
    .map((k) => `${k}="${String(labels[k]).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)
    .join(",");
}

class Registry
{
  private counters = new Map<string, CounterSeries>();
  private histograms = new Map<string, HistogramSeries>();

  counter(name: string, help: string, labels: LabelMap = {}, value = 1): void {
    let series = this.counters.get(name);
    if (!series) {
      series = { help, values: new Map() };
      this.counters.set(name, series);
    }
    const key = labelKey(labels);
    series.values.set(key, (series.values.get(key) ?? 0) + value);
  }

  observe(name: string, help: string, value: number): void {
    let series = this.histograms.get(name);
    if (!series) {
      series = { help, count: 0, sum: 0, max: 0 };
      this.histograms.set(name, series);
    }
    series.count += 1;
    series.sum += value;
    series.max = Math.max(series.max, value);
  }

  /** Prometheus text exposition format. */
  render(): string {
    const lines: string[] = [];
    for (const [name, series] of this.counters) {
      lines.push(`# HELP ${name} ${series.help}`);
      lines.push(`# TYPE ${name} counter`);
      if (series.values.size === 0) {
        lines.push(`${name} 0`);
      }
      for (const [key, value] of series.values) {
        lines.push(key ? `${name}{${key}} ${value}` : `${name} ${value}`);
      }
    }
    for (const [name, series] of this.histograms) {
      lines.push(`# HELP ${name} ${series.help}`);
      lines.push(`# TYPE ${name} summary`);
      lines.push(`${name}_count ${series.count}`);
      lines.push(`${name}_sum ${series.sum}`);
      lines.push(`${name}_max ${series.max}`);
    }
    return lines.join("\n") + "\n";
  }

  reset(): void {
    this.counters.clear();
    this.histograms.clear();
  }
}

export const metrics = new Registry();

// ---- Domain metric helpers (single call sites, no scattered literals) ----

export const METRIC_HELP = {
  http_requests_total: "Total HTTP requests",
  http_5xx_total: "Total HTTP 5xx responses",
  http_latency_ms: "HTTP request latency in milliseconds",
  db_latency_ms: "Database operation latency in milliseconds",
  redis_latency_ms: "Redis operation latency in milliseconds",
  payment_webhook_lag_ms: "Webhook receive-to-process latency in milliseconds",
  payment_success_total: "Payments that reached SUCCEEDED",
  license_verify_failures_total: "DRM license/lease verification failures",
  sandbox_failures_total: "Sandbox validation failures",
  download_failures_total: "Denied or failed artifact downloads",
  email_failures_total: "Email send failures",
} as const;

export function incLicenseVerifyFailure(): void {
  metrics.counter("license_verify_failures_total", METRIC_HELP.license_verify_failures_total);
}

export function incDownloadFailure(): void {
  metrics.counter("download_failures_total", METRIC_HELP.download_failures_total);
}

export function incSandboxFailure(): void {
  metrics.counter("sandbox_failures_total", METRIC_HELP.sandbox_failures_total);
}

export function incEmailFailure(): void {
  metrics.counter("email_failures_total", METRIC_HELP.email_failures_total);
}

export function incPaymentSuccess(): void {
  metrics.counter("payment_success_total", METRIC_HELP.payment_success_total);
}
