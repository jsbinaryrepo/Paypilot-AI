import { open, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createClient } from "@libsql/client";
import { readConfig } from "./config.js";
import { runHostedMigrations } from "./hosted-migrations.js";

const config = readConfig(process.env);
if (config.ACCOUNTS_ENABLED === "true") {
  const client = createClient({ url: config.TURSO_DATABASE_URL!, authToken: config.TURSO_AUTH_TOKEN! });
  try {
    await runHostedMigrations(client);
  } catch {
    console.error("Hosted database migration failed. Check Turso configuration and migration history.");
    process.exitCode = 1;
  } finally { client.close(); }
} else {
const file = config.DATABASE_URL.slice(5);
if (file.includes("?") || file === ":memory:")
  throw new Error("Use a local SQLite file for migrations.");
const path = resolve("prisma", file);
await mkdir(dirname(path), { recursive: true });
// Append mode creates a missing SQLite file without truncating existing data.
await (await open(path, "a")).close();
const child = spawn(
  process.execPath,
  [resolve("node_modules/prisma/build/index.js"), "migrate", "deploy"],
  { stdio: "inherit" },
);
child.on("error", () => {
  console.error("Unable to launch Prisma migration command.");
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
}
