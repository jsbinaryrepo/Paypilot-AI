import { open, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { spawn } from "node:child_process";
import { readConfig } from "./config.js";

const config = readConfig(process.env);
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
