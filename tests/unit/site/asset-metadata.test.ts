// PLAN-018 N-001: pure asset metadata parser unit tests. No DB.
import { describe, it, expect } from "vitest";
import {
  parseAssetMetadata,
  extractEntryNames,
  TEXT_PARSE_LIMIT,
  ZIP_ENTRY_LIMIT,
} from "@server/lib/artifact/metadata";
import { buildZip } from "@tests/tools/helpers/zip";

const OBJ_SAMPLE = [
  "# test cube",
  "mtllib cube.mtl",
  "v 0 0 0",
  "v 1 0 0",
  "v 1 1 0",
  "v 0 1 0",
  "vn 0 0 1",
  "vt 0 0",
  "f 1/1/1 2/1/1 3/1/1 4/1/1",
  "f 1/1/1 3/1/1 4/1/1",
  "",
].join("\n");

const GLTF_SAMPLE = {
  asset: { version: "2.0" },
  meshes: [
    { name: "body_lod0", primitives: [{}, {}] },
    { name: "wheel", primitives: [{}] },
  ],
  textures: [{}, {}, {}],
  materials: [{}, {}],
  animations: [{ name: "idle" }],
  skins: [{ joints: ["a", "b", "c", "d"] }],
  extensionsUsed: ["KHR_materials_emissive"],
};

describe("parseAssetMetadata — obj", () => {
  it("counts v/vn/vt/f lines and mtllib references", async () => {
    const meta = await parseAssetMetadata("model.obj", Buffer.from(OBJ_SAMPLE, "utf8"));
    expect(meta.format).toBe("obj");
    expect(meta.polycount).toBe(2); // two face lines
    expect(meta.materials).toBe(1); // one mtllib ref
    expect(meta.bones).toBeNull(); // plain obj has no skeleton
  });

  it("reports nulls for malformed/garbage obj content", async () => {
    const meta = await parseAssetMetadata("model.obj", Buffer.from("this is not an obj\n".repeat(10), "utf8"));
    expect(meta.format).toBe("obj");
    expect(meta.polycount).toBe(0); // parsed honestly: zero faces
    expect(meta.materials).toBeNull();
  });

  it("flags truncation for oversized text (header-only scan)", async () => {
    const big = OBJ_SAMPLE + "\n".repeat(TEXT_PARSE_LIMIT);
    const meta = await parseAssetMetadata("big.obj", Buffer.from(big, "utf8"));
    expect(meta.format).toBe("obj");
    expect(meta.truncated).toBe(true);
  });
});

describe("parseAssetMetadata — gltf", () => {
  it("counts primitives, textures, materials, animations, bones", async () => {
    const meta = await parseAssetMetadata(
      "model.gltf",
      Buffer.from(JSON.stringify(GLTF_SAMPLE), "utf8")
    );
    expect(meta.format).toBe("gltf");
    expect(meta.polycount).toBe(3); // 2 + 1 primitives
    expect(meta.textures).toBe(3);
    expect(meta.materials).toBe(2);
    expect(meta.animations).toBe(1);
    expect(meta.bones).toBe(4); // skin joints
  });

  it("returns unknown for malformed JSON", async () => {
    const meta = await parseAssetMetadata("model.gltf", Buffer.from("{not json", "utf8"));
    expect(meta.format).toBe("unknown");
    expect(meta.polycount).toBeNull();
    expect(meta.textures).toBeNull();
  });

  it("reports LOD hints from mesh names", async () => {
    const doc = {
      meshes: [
        { name: "chassis_lod0", primitives: [{}] },
        { name: "chassis_lod1", primitives: [{}] },
        { name: "chassis_LOD2", primitives: [{}] },
      ],
    };
    const meta = await parseAssetMetadata(
      "car.gltf",
      Buffer.from(JSON.stringify(doc), "utf8")
    );
    expect(meta.lodHints).toBe(3);
  });
});

describe("parseAssetMetadata — zip artifacts", () => {
  it("lists bounded entries and counts asset types", async () => {
    const zip = buildZip([
      { path: "resource/meta.xml", content: "<meta/>" },
      { path: "resource/main.lua", content: "print('hi')" },
      { path: "resource/models/car.obj", content: OBJ_SAMPLE },
      { path: "resource/models/scene.gltf", content: JSON.stringify(GLTF_SAMPLE) },
      { path: "resource/textures/skin.png", content: "png-bytes" },
      { path: "resource/textures/detail.dds", content: "dds-bytes" },
    ]);
    const meta = await parseAssetMetadata("artifact.zip", zip);
    expect(meta.format).toBe("zip");
    expect(meta.entryNames).toHaveLength(6);
    const names = meta.entryNames ?? [];
    expect(names).toContain("resource/main.lua");
    // First model entry (.gltf) drives polycount/materials
    expect(meta.polycount).toBe(3); // gltf primitives
    expect(meta.materials).toBe(2);
    expect(meta.textures).toBe(3);
  });

  it("reports nulls honestly for a malformed zip", async () => {
    const meta = await parseAssetMetadata("broken.zip", Buffer.from("PK\x03\x04 not really a zip"));
    expect(meta.format).toBe("zip");
    expect(meta.entryNames).toBeNull();
    expect(meta.polycount).toBeNull();
  });
});

describe("extractEntryNames — bounded zip listing", () => {
  it("lists all entries of a small archive", async () => {
    const zip = buildZip([
      { path: "a.lua", content: "a" },
      { path: "b/b.lua", content: "b" },
      { path: "c.dds", content: "c" },
    ]);
    const listing = await extractEntryNames(zip);
    expect(listing.total).toBe(3);
    expect(listing.names).toEqual(["a.lua", "b/b.lua", "c.dds"]);
  });

  it("caps the listing at 500 names while counting the true total", async () => {
    const entries = [];
    for (let i = 0; i < ZIP_ENTRY_LIMIT + 12; i++) {
      entries.push({ path: `f${i}.lua`, content: `x${i}` });
    }
    const listing = await extractEntryNames(buildZip(entries));
    expect(listing.total).toBe(ZIP_ENTRY_LIMIT + 12);
    expect(listing.names.length).toBe(ZIP_ENTRY_LIMIT);
  });
});

describe("parseAssetMetadata — unknown formats", () => {
  it("returns honest nulls for unknown binary formats", async () => {
    const meta = await parseAssetMetadata("blob.bin", Buffer.from([0xde, 0xad, 0xbe, 0xef]));
    expect(meta.format).toBe("unknown");
    expect(meta.polycount).toBeNull();
    expect(meta.textures).toBeNull();
    expect(meta.materials).toBeNull();
    expect(meta.bones).toBeNull();
    expect(meta.animations).toBeNull();
  });
});