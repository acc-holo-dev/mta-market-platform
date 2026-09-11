#!/usr/bin/env tsx
// PLAN-001 G-004/N-002: reproducible development ADMIN account.
//
//   npx tsx scripts/dev-admin.ts --email admin@example.com --username admin --password 'dev-password-123'
//   npx tsx scripts/dev-admin.ts --promote --email existing@example.com
//
// Creates the user if missing (with a password hash) or promotes an existing
// user to ADMIN. DEVELOPMENT/TEST tooling: refuses to run when
// NODE_ENV=production unless ALLOW_ADMIN_BOOTSTRAP=true is set explicitly by
// the operator (no hidden backdoor — every use is logged).

import bcrypt from "bcryptjs";
import { db } from "../src/prisma/db";

async function main() {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_ADMIN_BOOTSTRAP !== "true") {
    console.error(
      "REFUSED: NODE_ENV=production. Set ALLOW_ADMIN_BOOTSTRAP=true to override explicitly."
    );
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const get = (name: string): string | undefined => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const has = (name: string): boolean => args.includes(name);

  const email = get("--email")?.toLowerCase();
  const username = get("--username");
  const password = get("--password");
  const promote = has("--promote");

  if (promote) {
    // Promote an EXISTING user (documented admin mechanism).
    if (!email && !username) {
      console.error("Usage: --promote --email <email> | --username <username>");
      process.exit(1);
    }
    const user = email
      ? await db.orm.public.User.where({ email }).first()
      : await db.orm.public.User.where({ username: username! }).first();
    if (!user) {
      console.error("User not found.");
      process.exit(1);
    }
    await db.orm.public.User.where({ id: user.id }).update({ role: "ADMIN" });
    console.log(`✅ Promoted ${user.email} to ADMIN.`);
    process.exit(0);
  }

  if (!email || !username || !password || password.length < 8) {
    console.error(
      "Usage: npx tsx scripts/dev-admin.ts --email a@b.c --username admin --password 'min-8-chars'"
    );
    process.exit(1);
  }

  const existing = await db.orm.public.User.where({ email }).first();
  const passwordHash = await bcrypt.hash(password, 10);
  let userId: string;
  if (existing) {
    await db.orm.public.User.where({ id: existing.id }).update({
      role: "ADMIN",
      passwordHash,
    });
    userId = existing.id;
    console.log(`✅ Existing user ${email} promoted to ADMIN (password set).`);
  } else {
    const created = await db.orm.public.User.create({
      email,
      username,
      passwordHash,
      role: "ADMIN",
      status: "ACTIVE",
    });
    userId = created.id;
    console.log(`✅ Admin account created: ${email} / ${username}`);
  }

  // C-002: admin account also starts with a persisted zero balance.
  const balance = await db.orm.public.UserBalance.where({ userId }).first();
  if (!balance) {
    await db.orm.public.UserBalance.create({
      userId,
      available: 0,
      currency: "RUB",
    });
  }
  process.exit(0);
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
