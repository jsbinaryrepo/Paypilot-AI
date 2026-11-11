import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import type { Client } from "@libsql/client";

export async function runHostedMigrations(client: Client) {
  await client.execute(`CREATE TABLE IF NOT EXISTS "PayPilotMigration" ("name" TEXT PRIMARY KEY, "checksum" TEXT NOT NULL)`);
  const folders = (await readdir(resolve("prisma/migrations"), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  for (const name of folders) {
    const sql = await readFile(resolve("prisma/migrations", name, "migration.sql"), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const applied = await client.execute({ sql: `SELECT "checksum" FROM "PayPilotMigration" WHERE "name" = ?`, args: [name] });
    if (applied.rows.length) {
      if (applied.rows[0].checksum !== checksum) throw new Error(`Migration changed: ${name}`);
      continue;
    }
    const statements = sql.split(";").map((part) => part.replace(/^\s*(?:--[^\n]*\n\s*)*/g, "").trim()).filter(Boolean);
    await client.batch([...statements, { sql: `INSERT INTO "PayPilotMigration" ("name", "checksum") VALUES (?, ?)`, args: [name, checksum] }], "write");
  }
}
