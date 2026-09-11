// Prisma Client wrapper for MTA Market
// Direct alias over the generated contract ORM. Exposes every model in the
// emitted contract (including Lease, ServerSigningKey, ArtifactSignature used
// by DRM v2). Do not hand-list models here: the contract is the source of truth.
import { db } from "../prisma/db";

// Explicit annotation: the inferred type is not nameable across pnpm
// store paths (TS2742) when emitting declarations.
export const prisma: typeof db.orm.public = db.orm.public;