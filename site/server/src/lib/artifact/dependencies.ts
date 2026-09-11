/**
 * PLAN I-002: dependency graph validation.
 *
 * A resource declares dependencies on other resources (by slug, optional
 * minVersion/type). Before publication the graph must resolve against the
 * PUBLISHED catalog:
 * - MISSING: a dependency slug has no published resource;
 * - UNSUPPORTED: a dependency's declared type does not match the target
 *   resource's type;
 * - VERSION_CONFLICT: two declarations on the same slug carry conflicting
 *   minimum versions;
 * - CIRCULAR: the dependency graph contains a cycle (including self).
 *
 * Runs at the publication gate (admin publish) and is unit-tested.
 */

import { db } from "../../prisma/db";

export interface DependencyCheckResult {
  ok: boolean;
  errors: string[];
  /** Resolved graph edges (slug -> dependency slugs) for diagnostics. */
  edges: Record<string, string[]>;
}

function versionParts(version: string): number[] {
  return version
    .split(".")
    .map((part) => Number.parseInt(part, 10) || 0);
}

/** Dotted numeric version comparison: actual >= min. */
export function versionSatisfiesMin(actual: string, min?: string | null): boolean {
  if (!min) return true;
  const a = versionParts(actual);
  const b = versionParts(min);
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;
    if (left !== right) return left > right;
  }
  return true;
}

function detectCycle(graph: Record<string, string[]>): string | null {
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (node: string): string | null => {
    if (visiting.has(node)) return node;
    if (visited.has(node)) return null;
    visiting.add(node);
    for (const next of graph[node] ?? []) {
      const cycle = visit(next);
      if (cycle) return cycle;
    }
    visiting.delete(node);
    return null;
  };

  for (const node of Object.keys(graph)) {
    const cycle = visit(node);
    if (cycle) return cycle;
  }
  return null;
}

/** Latest published version string of a resource (for minVersion checks). */
async function latestPublishedVersion(
  resourceId: string
): Promise<{ version: string; releaseStatus: string } | null> {
  const versions = await db.orm.public.ResourceVersion
    .where({ resourceId })
    .orderBy((m) => m.publishedAt.desc())
    .all();
  return versions[0] ?? null;
}

/**
 * Validates the dependency graph rooted at `resourceSlug` (its declarations
 * plus, transitively, the declarations of its targets).
 */
export async function validateResourceDependencies(resourceSlug: string): Promise<DependencyCheckResult> {
  const errors: string[] = [];
  const graph: Record<string, string[]> = {};

  const root = await db.orm.public.Resource.where({ slug: resourceSlug }).first();
  if (!root) {
    return { ok: false, errors: ["Root resource not found"], edges: {} };
  }

  const rootDeps = await db.orm.public.ResourceDependency
    .where({ resourceId: root.id })
    .all();

  // VERSION_CONFLICT: conflicting minimum versions declared for one target.
  const bySlug = new Map<string, string[]>();
  for (const dep of rootDeps) {
    if (!dep.minVersion) continue;
    const list = bySlug.get(dep.dependsOnSlug) ?? [];
    list.push(dep.minVersion);
    bySlug.set(dep.dependsOnSlug, list);
  }
  for (const [slug, mins] of bySlug) {
    const unique = new Set(mins);
    if (unique.size > 1) {
      errors.push(`VERSION_CONFLICT: "${slug}" declared with conflicting minVersions (${[...unique].join(", ")})`);
    }
  }

  // Walk the graph breadth-first; edges resolve against PUBLISHED resources.
  const seen = new Set<string>([resourceSlug]);
  const queue: Array<{ slug: string; minVersion?: string | null; type?: string | null }> = [
    ...rootDeps.map((d) => ({ slug: d.dependsOnSlug, minVersion: d.minVersion, type: d.type })),
  ];
  graph[resourceSlug] = rootDeps.map((d) => d.dependsOnSlug);

  while (queue.length > 0) {
    const { slug, minVersion, type } = queue.shift()!;
    const target = await db.orm.public.Resource.where({ slug }).first();
    if (!target || target.status !== "PUBLISHED") {
      errors.push(`MISSING: dependency "${slug}" is not a published resource`);
      continue;
    }
    if (type && target.type !== type) {
      errors.push(
        `UNSUPPORTED: dependency "${slug}" declared as type ${type}, but the resource is ${target.type}`
      );
    }
    if (minVersion) {
      const latest = await latestPublishedVersion(target.id);
      if (latest && !versionSatisfiesMin(latest.version, minVersion)) {
        errors.push(
          `VERSION_CONFLICT: "${slug}" latest published version ${latest.version} does not satisfy ${minVersion}`
        );
      }
    }
    if (seen.has(slug) && slug !== resourceSlug) {
      // Already walked (or queued): avoid re-walking, but record the edge.
      continue;
    }
    if (slug === resourceSlug) {
      errors.push(`CIRCULAR: "${slug}" depends on itself`);
      continue;
    }
    if (!seen.has(slug)) {
      seen.add(slug);
    }
    const nextDeps = await db.orm.public.ResourceDependency
      .where({ resourceId: target.id })
      .all();
    graph[slug] = nextDeps.map((d) => d.dependsOnSlug);
    for (const next of nextDeps) {
      if (!seen.has(next.dependsOnSlug)) {
        seen.add(next.dependsOnSlug);
        queue.push({ slug: next.dependsOnSlug, minVersion: next.minVersion, type: next.type });
      }
    }
  }

  const cycle = detectCycle(graph);
  if (cycle) {
    errors.push(`CIRCULAR: dependency cycle through "${cycle}"`);
  }

  return { ok: errors.length === 0, errors, edges: graph };
}
