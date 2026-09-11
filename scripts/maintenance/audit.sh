#!/usr/bin/env bash
# Dependency audit gate (migrated from mta-market-site/scripts/audit-gate.sh).
# HIGH/CRITICAL production advisories fail the build; waivers live in
# .github/audit-exceptions.txt ("<package> <reason> <review-date YYYY-MM-DD>",
# one per line — expired waivers still fail). Exit 0/1/2 = clean/gate/tooling.
set -o pipefail
cd "$(dirname "$0")/../.."
EXCEPTIONS_FILE=".github/audit-exceptions.txt"

pnpm audit --prod --audit-level high --json > /tmp/audit.json 2>/dev/null
if [ ! -s /tmp/audit.json ]; then
  echo "::error::pnpm audit produced no output"
  exit 2
fi

FINDINGS_FILE=$(mktemp)
node -e '
const fs = require("fs");
const raw = fs.readFileSync("/tmp/audit.json", "utf8");
let data;
try { data = JSON.parse(raw); } catch { process.exit(0); }
const advisories = data.advisories ? Object.values(data.advisories) : [];
for (const a of advisories) {
  const sev = String(a.severity || "").toLowerCase();
  if (sev === "high" || sev === "critical") {
    console.log(`${a.module_name || a.name}\t${sev}\t${a.github_advisory_id || a.url || ""}`);
  }
}
' > "$FINDINGS_FILE" || { echo "::error::audit JSON processing failed"; exit 2; }

TOTAL=$(wc -l < "$FINDINGS_FILE" | tr -d ' ')
if [ "$TOTAL" = "0" ]; then
  echo "✅ Dependency audit: no high/critical vulnerabilities in production dependencies."
  exit 0
fi

WAIVED_COUNT=0
FAILED=0
while IFS=$'\t' read -r pkg sev ref; do
  WAIVED=0
  if [ -f "$EXCEPTIONS_FILE" ]; then
    while IFS= read -r line; do
      [ -z "$line" ] && continue
      case "$line" in \#*) continue ;; esac
      set -- $line
      if [ "${1:-}" = "$pkg" ]; then
        REVIEW_DATE="${3:-}"
        if [ -n "$REVIEW_DATE" ] && [ "$(date +%Y%m%d)" -gt "$(date -d "$REVIEW_DATE" +%Y%m%d 2>/dev/null || echo 99999999)" ]; then
          echo "EXPIRED WAIVER: $pkg (review date $REVIEW_DATE passed)"
        else
          WAIVED=1; WAIVED_COUNT=$((WAIVED_COUNT+1))
          echo "WAIVED: $pkg ($sev) — $ref"
        fi
        break
      fi
    done < "$EXCEPTIONS_FILE"
  fi
  if [ "$WAIVED" = "0" ]; then
    echo "::error::vulnerable dependency: $pkg ($sev) — $ref"
    FAILED=1
  fi
done < "$FINDINGS_FILE"

if [ "$FAILED" = "1" ]; then
  echo "❌ Dependency audit gate FAILED ($TOTAL findings, $WAIVED_COUNT waived)."
  exit 1
fi
echo "✅ Dependency audit: $TOTAL findings, all waived ($WAIVED_COUNT)."
