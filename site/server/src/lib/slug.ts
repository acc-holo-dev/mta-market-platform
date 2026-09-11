// PLAN-005 X/URL architecture: readable slugs for servers and forum
// categories. Follows the existing Service slug approach (ASCII, lowercase)
// but adds RU transliteration so Russian server names become readable URLs
// instead of empty bases.
const TRANSLIT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh",
  з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o",
  п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts",
  ч: "ch", ш: "sh", щ: "sch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu",
  я: "ya",
  і: "i", ї: "yi", є: "e", ґ: "g", // west-slavic extras
};

/** Deterministic, URL-safe, human-readable base slug (no uniqueness suffix). */
export function slugifyBase(input: string): string {
  const transliterated = input
    .toLowerCase()
    .split("")
    .map((ch) => TRANSLIT[ch] ?? ch)
    .join("");
  return transliterated
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48);
}

/**
 * Server slug: readable base + short random suffix for uniqueness, mirroring
 * the Service slug convention. Callers must still verify uniqueness against
 * the DB and retry.
 */
export function makeServerSlug(name: string): string {
  const base = slugifyBase(name).slice(0, 48);
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${base || "server"}-${suffix}`;
}