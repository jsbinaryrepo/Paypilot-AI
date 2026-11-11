import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { PrismaClient } from "@prisma/client";
import { PrismaLibSQL } from "@prisma/adapter-libsql";
import { runHostedMigrations } from "./hosted-migrations.js";

test("hosted migration history applies once to a fresh libSQL database", async () => {
  const folder = await mkdtemp(join(tmpdir(), "paypilot-libsql-"));
  const url = `file:${join(folder, "db.sqlite").replaceAll("\\", "/")}`;
  const client = createClient({ url });
  let db: PrismaClient | undefined;
  try {
    await runHostedMigrations(client);
    await runHostedMigrations(client);
    const migrations = await client.execute(`SELECT COUNT(*) AS total FROM "PayPilotMigration"`);
    assert.equal(Number(migrations.rows[0].total), 7);
    const tables = await client.execute(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('User','Session','Invoice','Payment','Checkout','InvoiceDelivery')`);
    assert.equal(tables.rows.length, 6);
    db = new PrismaClient({ adapter: new PrismaLibSQL({ url }) });
    const account = await db.user.create({ data: { email: "hosted@example.test" } });
    assert.equal((await db.user.findUnique({ where: { id: account.id } }))?.email, "hosted@example.test");
  } finally {
    if (db) await db.$disconnect();
    client.close();
    await rm(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
