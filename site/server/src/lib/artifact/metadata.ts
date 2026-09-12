// PLAN-018 N-001: pure 3D/asset metadata parser.
// NO database access, NO network, NO filesystem — buffers in, bounded facts
// out. Unknown/unparseable inputs produce nulls (honest reporting): the
// parser never guesses and never throws on malformed content.
//
// Bounds (deliberate):
// - text formats (.obj/.gltf): full parse only when ≤ 2 MB; larger files are
//   header-scanned (first 4 KB) and reported as truncated/nulls.
// - .zip artifacts: entry-name listing bounded to the first 500 entries;
//   the first .gltf/.obj entry inside is parsed for a polycount estimate.
import { PassThrough } from "stream";
import { Parse } from "unzipper";

export const TEXT_PARSE_LIMIT = 2 * 1024 * 1024; // 2 MB full text parse
export const HEADER_SCAN_BYTES = 4 * 1024; // 4 KB header window
export const ZIP_ENTRY_LIMIT = 500;

export interface AssetMetadata {
  /** Detected container/model format: obj | gltf | zip | unknown */
  format: "obj" | "gltf" | "zip" | "unknown";
  /** Face/primitive count estimate */
  polycount?: number | null;
  textures?: number | null;
  materials?: number | null;
  bones?: number | null;
  animations?: number | null;
  /** Number of distinct LOD levels hinted by mesh/entry names */
  lodHints?: number | null;
  /** Bounded zip entry-name listing (zip format only) */
  entryNames?: string[] | null;
  /** True when input exceeded parse bounds (facts are partial) */
  truncated?: boolean;
}

export interface ZipListing {
  /** Up to ZIP_ENTRY_LIMIT entry paths */
  names: string[];
  /** Total entries seen while streaming (may exceed names.length) */
  total: number;
}

/** Lowercased extension of a path/filename without the dot. */
function extOf(name: string): string {
  const base = name.replace(/\\/g, "/").split("/").pop() ?? name;
  const dot = base.lastIndexOf(".");
  return dot === -1 ? "" : base.slice(dot + 1).toLowerCase();
}

function basename(name: string): string {
  return name.replace(/\\/g, "/").split("/").pop() ?? name;
}

/**
 * Bounded zip entry-name listing. Reads ONLY the central entry metadata
 * (autodrain discards content) — the same in-memory pattern as
 * lib/sandbox/static.ts. Bounded at ZIP_ENTRY_LIMIT names.
 */
export async function extractEntryNames(buffer: Buffer): Promise<ZipListing> {
  return new Promise<ZipListing>((resolve, reject) => {
    const names: string[] = [];
    let total = 0;
    const parse = Parse();

    parse.on("entry", (entry: any) => {
      total += 1;
      if (names.length < ZIP_ENTRY_LIMIT && entry.type !== "Directory") {
        names.push(String(entry.path));
      }
      entry.autodrain();
    });
    parse.on("finish", () => resolve({ names, total }));
    parse.on("error", (error: Error) => reject(error));

    const stream = new PassThrough();
    stream.end(buffer);
    stream.pipe(parse);
  });
}

/** LOD levels hinted in names like `mesh_lod2`, `lod-3`, `LOD1`. */
function lodLevelsFromNames(names: string[]): number | null {
  const levels = new Set<number>();
  for (const name of names) {
    const m = /(?:^|[_\-\s.])lod\s*(\d+)(?:$|[_\-\s.])/i.exec(basename(name));
    if (m) levels.add(parseInt(m[1], 10));
  }
  return levels.size > 0 ? levels.size : null;
}

/** .obj parser: counts v/vn/vt/f lines, mtllib refs, bounding box estimate. */
function parseObj(text: string, truncated: boolean): AssetMetadata {
  let vertices = 0;
  let normals = 0;
  let uvs = 0;
  let faces = 0;
  let materials = 0;
  const lodNames: string[] = [];
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("v ")) {
      const parts = line.slice(2).trim().split(/\s+/);
      const x = Number(parts[0]), y = Number(parts[1]), z = Number(parts[2]);
      if (Number.isFinite(x)) { if (x < minX) minX = x; if (x > maxX) maxX = x; }
      if (Number.isFinite(y)) { if (y < minY) minY = y; if (y > maxY) maxY = y; }
      if (Number.isFinite(z)) { if (z < minZ) minZ = z; if (z > maxZ) maxZ = z; }
      vertices += 1;
      lodNames.push(raw); // v lines feed nothing LOD-wise; kept cheap
    } else if (line.startsWith("f ")) {
      faces += 1;
    } else if (line.startsWith("vn ")) {
      normals += 1;
    } else if (line.startsWith("vt ")) {
      uvs += 1;
    } else if (line.startsWith("mtllib ")) {
      materials += 1;
    }
  }

  const hasGeometry = vertices > 0 && Number.isFinite(minX);
  void lodNames;
  void hasGeometry;
  return {
    format: "obj",
    polycount: faces,
    materials: materials > 0 ? materials : null,
    textures: null, // .obj cannot reference textures directly (mtl files do)
    bones: null, // plain .obj has no skeleton
    animations: null,
    lodHints: lodLevelsFromNames(text.split(/\r?\n/)),
    entryNames: null,
    truncated,
  };
}

/** .gltf (JSON) parser: meshes/primitives/textures/materials/animations/skins. */
function parseGltf(text: string, truncated: boolean): AssetMetadata | null {
  let doc: any;
  try {
    doc = JSON.parse(text);
  } catch {
    return null; // honest: malformed JSON → unknown
  }
  if (typeof doc !== "object" || doc === null) return null;

  const meshes: any[] = Array.isArray(doc.meshes) ? doc.meshes : [];
  let primitives = 0;
  for (const mesh of meshes) {
    if (Array.isArray(mesh.primitives)) primitives += mesh.primitives.length;
  }
  const skins: any[] = Array.isArray(doc.skins) ? doc.skins : [];
  let bones = 0;
  for (const skin of skins) {
    if (Array.isArray(skin.joints)) bones += skin.joints.length;
  }
  const meshNames: string[] = meshes.map((m) => String(m.name ?? ""));
  return {
    format: "gltf",
    polycount: primitives,
    textures: Array.isArray(doc.textures) ? doc.textures.length : null,
    materials: Array.isArray(doc.materials) ? doc.materials.length : null,
    bones: skins.length > 0 ? bones : null,
    animations: Array.isArray(doc.animations) ? doc.animations.length : null,
    lodHints: lodLevelsFromNames(meshNames),
    entryNames: null,
    truncated,
  };
}

const ASSET_TYPE_EXTS: Record<string, string> = {
  obj: "obj",
  gltf: "gltf",
  fbx: "fbx",
  dds: "dds",
  png: "png",
  lua: "lua",
};

/**
 * Parse asset metadata from a file buffer.
 * Bounded: text formats are fully parsed only up to 2 MB; the first 4 KB
 * header window is scanned otherwise. Zip artifacts get a bounded entry
 * listing plus a best-effort parse of the first .gltf/.obj entry.
 */
export async function parseAssetMetadata(
  fileName: string,
  buffer: Buffer
): Promise<AssetMetadata> {
  const ext = extOf(fileName);
  const zipMagic = buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;

  // ---- zip artifact ------------------------------------------------------
  if (ext === "zip" || (!ext && zipMagic)) {
    try {
      const listing = await extractEntryNames(buffer);
      const counts: Record<string, number> = {};
      for (const name of listing.names) {
        const t = ASSET_TYPE_EXTS[extOf(name)];
        if (t) counts[t] = (counts[t] ?? 0) + 1;
      }
      // Best-effort polycount from the first parseable model entry.
      let modelMeta: AssetMetadata | null = null;
      for (const target of ["gltf", "obj"]) {
        const entry = listing.names.find((n) => extOf(n) === target);
        if (!entry) continue;
        const content = await readZipEntry(buffer, entry, TEXT_PARSE_LIMIT);
        if (!content) continue;
        modelMeta =
          target === "gltf"
            ? parseGltf(content.toString("utf8"), content.length >= TEXT_PARSE_LIMIT)
            : parseObj(content.toString("utf8"), content.length >= TEXT_PARSE_LIMIT);
        if (modelMeta) break;
      }
      return {
        format: "zip",
        polycount: modelMeta?.polycount ?? null,
        textures: modelMeta?.textures ?? null,
        materials: modelMeta?.materials ?? null,
        bones: modelMeta?.bones ?? null,
        animations: modelMeta?.animations ?? null,
        lodHints: modelMeta?.lodHints ?? lodLevelsFromNames(listing.names),
        entryNames: listing.names,
        truncated: listing.total > listing.names.length,
      };
    } catch {
      // Malformed zip → honest unknown.
      return { format: "zip", polycount: null, textures: null, materials: null, bones: null, animations: null, lodHints: null, entryNames: null, truncated: true };
    }
  }

  // ---- text model formats --------------------------------------------------
  const isObj = ext === "obj" || (!ext && /^\s*(mtllib|#|\dv)/.test(buffer.subarray(0, Math.min(buffer.length, HEADER_SCAN_BYTES)).toString("utf8")));
  const isGltf = ext === "gltf" || (!ext && /^\s*\{/.test(buffer.subarray(0, Math.min(buffer.length, HEADER_SCAN_BYTES)).toString("utf8")));

  if (isObj || isGltf) {
    if (buffer.length <= TEXT_PARSE_LIMIT) {
      const text = buffer.toString("utf8");
      const meta = isGltf ? parseGltf(text, false) : parseObj(text, false);
      if (meta) return meta;
      return unknown();
    }
    // Over the bound: header scan only, facts partial.
    const head = buffer.subarray(0, HEADER_SCAN_BYTES).toString("utf8");
    const meta = isGltf ? parseGltf(head, true) : parseObj(head, true);
    return meta ?? unknown();
  }

  return unknown();
}

function unknown(): AssetMetadata {
  return {
    format: "unknown",
    polycount: null,
    textures: null,
    materials: null,
    bones: null,
    animations: null,
    lodHints: null,
    entryNames: null,
  };
}

/**
 * Read one zip entry's content in-memory with a hard byte bound.
 * Returns null when the entry is missing or exceeds the bound.
 */
async function readZipEntry(
  buffer: Buffer,
  entryPath: string,
  maxBytes: number
): Promise<Buffer | null> {
  return new Promise<Buffer | null>((resolve) => {
    const parse = Parse();
    let found: Buffer | null = null;
    let settled = false;

    const done = (value: Buffer | null) => {
      if (!settled) {
        settled = true;
        resolve(value);
      }
    };

    parse.on("entry", (entry: any) => {
      if (entry.path === entryPath && !found) {
        const chunks: Buffer[] = [];
        let size = 0;
        entry.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size <= maxBytes) chunks.push(chunk);
        });
        entry.on("end", () => {
          found = size <= maxBytes ? Buffer.concat(chunks) : null;
          done(found);
        });
      }
      entry.autodrain?.();
    });
    parse.on("finish", () => done(found));
    parse.on("error", () => done(found));

    const stream = new PassThrough();
    stream.end(buffer);
    stream.pipe(parse);
  });
}
