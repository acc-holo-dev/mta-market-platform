// PLAN-012 §21A codemod (Node.js edition — encoding-safe).
// Adds .js extensions to relative import/export specifiers in site/server/src.
// Handles UTF-8 and UTF-16 LE files (the repo's TS sources are UTF-16 LE);
// writes UTF-8 with BOM when the source had one, UTF-8 without otherwise.
const fs = require("fs");
const path = require("path");

const SRC = path.resolve(__dirname, "../../site/server/src");

function readText(file) {
  const buf = fs.readFileSync(file);
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return { text: buf.toString("utf16le").slice(1), hadUtf16Bom: true, hadUtf8Bom: false };
  }
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return { text: buf.slice(3).toString("utf8"), hadUtf16Bom: false, hadUtf8Bom: true };
  }
  // Some sources are UTF-16 LE without the trailing NUL check surviving the
  // checkout: detect by a UTF-16-decodable pattern (every second byte 0x00
  // in the first bytes for ASCII-leading content).
  if (buf.length >= 4 && (buf[1] === 0x00 || buf[0] === 0x2f)) {
    let nulls = 0;
    for (let i = 1; i < Math.min(buf.length, 40); i += 2) if (buf[i] === 0) nulls++;
    if (nulls > 10) {
      return { text: buf.toString("utf16le"), hadUtf16Bom: true, hadUtf8Bom: false };
    }
  }
  return { text: buf.toString("utf8"), hadUtf16Bom: false, hadUtf8Bom: false };
}

function writeText(file, text, hadUtf16Bom, hadUtf8Bom) {
  // UTF-16 LE sources keep their encoding; everything else becomes UTF-8
  // (with the BOM it had, if any). This is the one-time normalization that
  // makes the tree tool-stable.
  if (hadUtf16Bom) {
    const body = Buffer.from(text, "utf16le");
    const bom = Buffer.from([0xff, 0xfe]);
    fs.writeFileSync(file, Buffer.concat([bom, body]));
    return;
  }
  const body = Buffer.from(text, "utf8");
  if (hadUtf8Bom) {
    fs.writeFileSync(file, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body]));
  } else {
    fs.writeFileSync(file, body);
  }
}

const PATTERNS = [
  // import ... from "..." / export ... from "..." / import("...")
  /(from\s+|import\s*\(\s*)(["'])(\.\.?\/[^"']*)(["'])/g,
  // bare side-effect import: import "./x"
  /(import\s+)(["'])(\.\.?\/[^"']*)(["'])/g,
];

function fixSpecifiers(text) {
  let count = 0;
  for (const re of PATTERNS) {
    text = text.replace(re, (m, lead, q1, spec, q2) => {
      if (/\.(js|json|mjs|cjs|css|node)$/.test(spec)) return m;
      count++;
      return lead + q1 + spec + ".js" + q2;
    });
  }
  return { text, count };
}

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

const files = walk(SRC, []);
let total = 0;
let touched = 0;
for (const file of files) {
  const { text, hadUtf16Bom, hadUtf8Bom } = readText(file);
  const { text: fixed, count } = fixSpecifiers(text);
  if (count > 0) {
    writeText(file, fixed, hadUtf16Bom, hadUtf8Bom);
    total += count;
    touched++;
    console.log(`${path.relative(SRC, file)}: ${count}`);
  }
}
console.log(`DONE: ${touched} files, ${total} specifiers fixed`);
