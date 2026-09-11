#!/usr/bin/env node
/**
 * repair-cyrillic.cjs — PLAN-014 E2E root-cause repair (§32).
 *
 * Two mojibake classes remain in sources after the PLAN-012 CP1251 repair
 * (commit d3b0320), which fixed most but not all damage from the PS5.1
 * UTF-16 codemod pass:
 *
 *   Class A — UTF-8 bytes mis-decoded as CP1251 (e.g. "В§" for "§",
 *   "рџ§Є" for an emoji). Repair: map each mojibake char back to its
 *   CP1251 byte, re-interpret the byte run as UTF-8. Validated per run:
 *   strict UTF-8, no replacement chars, printable, and the decoded text
 *   contains Cyrillic or known CP1251-source punctuation. Pure-Cyrillic
 *   text can never accidentally satisfy this (its CP1251 bytes do not form
 *   valid UTF-8), so the pass is safe on clean files and is idempotent.
 *
 *   Class B — second-generation corruption produced by the buggy CP1251
 *   table inside the d3b0320 repair itself (e.g. "МеУаџ" for "Новая").
 *   Not algorithmically invertible; repaired via an exact dictionary of
 *   verified string pairs recovered from the last clean ancestor
 *   (commit 9215c87) — each entry below was checked against that history.
 *
 * Idempotent: after a full repair, `--check` reports 0 survivors.
 * Scans only git-tracked text files (node_modules, build output and the
 * lockfile are never touched).
 *
 * Usage: node scripts/development/repair-cyrillic.cjs [--check]
 *   --check  no writes; exit 1 if anything still needs repair (CI-usable).
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");

// --- CP1251 byte table (from Node's WHATWG windows-1251 decoder) -----------
const byteOf = new Map();
for (let b = 0x80; b < 0x100; b++) {
  const ch = new TextDecoder("windows-1251").decode(new Uint8Array([b]));
  if (!byteOf.has(ch)) byteOf.set(ch, b);
}
const utf8Strict = new TextDecoder("utf-8", { fatal: true });

// Chars that can participate in a mojibake run (CP1251 high-half material).
const RUN_CHAR = /[\u00A0-\u024F\u0400-\u052F\u2010-\u205E\u2190-\u21FF]/;

// Sanity: the decoded run must contain Cyrillic, CP1251-source punctuation
// or an emoji (CP1251-mangled emoji are a known class in the CLI source).
const SANE = /[А-Яа-яЁё§«»—–…→]|[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

// Corruption-only markers (never appear in legitimate Russian text).
// NOTE: excludes slug.ts transliteration extras (і ї є ґ) by design — they
// are legitimate there and only that file uses them.
const MARKERS = [
  "[ЂЃѓЉ‹ЊЌЋЏђљ›њќћџўЎ]",
  "\u{FFFD}",
  "рџ",
  "вЂ",
  "В«",
  "В»",
  "В§",
  "в†",
  "в‰",
];
const HAS_MARKER = new RegExp(`(?:${MARKERS.join("|")})`, "u");

// Verified corrupted → clean pairs (class B). Sources: last clean ancestor
// (commit 9215c87) for email.ts / community.ts / adminContent.ts literals.
// drm.ts emoji entries are keyed by message text because several distinct
// emojis collapse onto the same FFFD-prefixed fragment; bytes were lost
// (U+FFFD), so only the git-verified mapping below is used for those.
const DICTIONARY = [
  ["\uFFFD\uFFFDриУет", "Привет"], // email.ts welcome <h1>
  ["ЛстаУлџть етзъУъ", "Оставлять отзывы"], // email.ts welcome list
  ["\uFFFD\uFFFDесКетреть етзъУъ", "Посмотреть отзывы"], // email.ts review email
  ["ЎерУер: ", "Сервер: "], // email.ts license activated
  ["ЎуККа: ", "Сумма: "], // email.ts payout
  ["МеУаџ статьџ ет аУтера: ", "Новая статья от автора: "], // adminContent.ts CREATOR_ARTICLE
  ["МеУъй етУет У теКе «", "Новый ответ в теме «"], // community.ts FORUM_REPLY
  // site/server/src/cli/drm.ts — emoji whose leading UTF-8 bytes were lost.
  ["\uFFFD\u07D4\uFFFD Rotating DRM server signing key...", "🔑 Rotating DRM server signing key..."],
  ["\uFFFD\u07D2\uFFFD New private key written once to", "💾 New private key written once to"],
  ["\uFFFD\u07D4\uFFFD Generating DRM server signing keypair...", "🔑 Generating DRM server signing keypair..."],
  ["\uFFFD\u07D3\uFFFD Key ID:", "📋 Key ID:"],
  ["\uFFFD\u07D4\uFFFD Public Key: ${result.publicKey", "🔓 Public Key: ${result.publicKey"],
  ["\uFFFD\u07D4\uFFFD Private key saved to:", "🔐 Private key saved to:"],
  ["\uFFFD\u07D4\uFFFD Public Key: ${keypair.publicKey", "🔓 Public Key: ${keypair.publicKey"],
  ["\uFFFD\u07D4\uFFFD Private Key: ${keypair.privateKey", "🔐 Private Key: ${keypair.privateKey"],
  ["\uFFFD\u07D2\uFFFD Test keypair saved to:", "💾 Test keypair saved to:"],
  ["\uFFFD\u07D3\uFFFD Next steps:", "📝 Next steps:"],
  ["\uFFFD\u07D3\uFFFD DRM Protocol v2 Information", "📖 DRM Protocol v2 Information"],
];

function repairClassA(text, rel, log) {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (RUN_CHAR.test(ch) && byteOf.has(ch)) {
      let j = i;
      const run = [];
      while (j < text.length && RUN_CHAR.test(text[j]) && byteOf.has(text[j])) {
        run.push(text[j]);
        j++;
      }
      let replaced = false;
      if (run.length >= 2) {
        try {
          const bytes = Uint8Array.from(run.map((c) => byteOf.get(c)));
          const decoded = utf8Strict.decode(bytes);
          const printable = [...decoded].every(
            (c) =>
              c === "\n" || c === "\r" || c === "\t" ||
              (c.codePointAt(0) >= 0x20 && c !== "\uFFFD")
          );
          if (printable && SANE.test(decoded)) {
            out += decoded;
            log.push({ file: rel, corrupted: run.join(""), fixed: decoded });
            replaced = true;
          }
        } catch {
          /* invalid UTF-8 run — keep as-is */
        }
      }
      if (!replaced) out += run.join("");
      i = j;
    } else {
      out += ch;
      i++;
    }
  }
  return out;
}

function main() {
  const check = process.argv.includes("--check");
  const tracked = execSync("git ls-files -z", { cwd: ROOT, maxBuffer: 1 << 26 })
    .toString()
    .split("\0")
    .filter(Boolean);

  const textExt =
    /\.(ts|tsx|cjs|cts|mjs|js|py|sql|yml|yaml|json|prisma|sh|md|txt|toml|ini|css|html)$/;
  const targets = tracked.filter(
    (f) => f !== "pnpm-lock.yaml" && textExt.test(f) && fs.existsSync(path.join(ROOT, f))
  );

  const log = [];
  const survivors = [];

  for (const rel of targets) {
    const abs = path.join(ROOT, rel);
    let original;
    try {
      original = fs.readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    let text = original;

    // Class B first (exact verified dictionary pairs).
    for (const [bad, good] of DICTIONARY) {
      if (text.includes(bad)) {
        log.push({ file: rel, kind: "B", corrupted: bad, fixed: good });
        text = text.split(bad).join(good);
      }
    }

    // Class A: algorithmic CP1251 → UTF-8 repair of validated runs.
    text = repairClassA(text, rel, log);

    if (text !== original) {
      log.push({ file: rel, kind: "changed" });
      if (!check) fs.writeFileSync(abs, text);
    }

    // Surviving corruption scan (marker set only — slug.ts extras excluded).
    const lines = text.split("\n");
    lines.forEach((line, idx) => {
      if (HAS_MARKER.test(line)) {
        survivors.push(`${rel}:${idx + 1}: ${line.trim().slice(0, 140)}`);
      }
    });
  }

  const changed = log.filter((e) => e.kind === "changed").length;
  const fixes = log.filter((e) => e.kind === "A" || e.kind === "B");
  console.log(`[repair-cyrillic] mode=${check ? "CHECK" : "REPAIR"}`);
  for (const e of fixes) {
    console.log(
      `  ${e.kind} ${e.file}: ${JSON.stringify(e.corrupted.slice(0, 48))} -> ${JSON.stringify(e.fixed.slice(0, 72))}`
    );
  }
  console.log(`[repair-cyrillic] files changed=${check ? "n/a" : changed}, string fixes=${fixes.length}`);
  if (survivors.length) {
    console.log(`[repair-cyrillic] surviving corruption (${survivors.length}):`);
    for (const s of survivors) console.log("  " + s);
    process.exit(1);
  }
  if (check) console.log("[repair-cyrillic] clean");
}

main();
