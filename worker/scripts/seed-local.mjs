// Prepares local `wrangler dev` state: applies D1 migrations and loads a pool
// into local KV. Uses the real generated pool when worker/.pool-kv/ exists
// (run build-pool-kv.mjs first), otherwise the synthetic fixture pool.
//
//   node scripts/seed-local.mjs [--fixture] [--fresh] [--persist-to <dir>]
//
// --fresh deletes the persisted local state first (used by the frontend e2e run).

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fixturePoolEntries } from "./fixture-pool.mjs";

const WORKER_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const persistAt = args.indexOf("--persist-to");
const persist = persistAt >= 0 ? ["--persist-to", args[persistAt + 1]] : [];
const realDir = join(WORKER_DIR, ".pool-kv");
const useFixture = args.includes("--fixture") || !existsSync(realDir);
if (args.includes("--fresh") && persistAt >= 0) rmSync(join(WORKER_DIR, args[persistAt + 1]), { recursive: true, force: true });

function wrangler(...rest) {
  execFileSync(process.platform === "win32" ? "npx.cmd" : "npx", ["wrangler", ...rest, ...persist], {
    cwd: WORKER_DIR,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
}

wrangler("d1", "migrations", "apply", "DB", "--local");

// The local KV proxy fails on bulk writes near 1 MB, so write in small chunks.
const LOCAL_CHUNK = 250;
const entries = useFixture
  ? fixturePoolEntries()
  : readdirSync(realDir)
      .filter((f) => f.endsWith(".json"))
      .flatMap((f) => JSON.parse(readFileSync(join(realDir, f), "utf8")));
console.log(useFixture ? "Seeding the synthetic fixture pool." : "Seeding the generated pool from .pool-kv/.");

const dir = join(WORKER_DIR, ".wrangler", "seed-chunks");
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
for (let i = 0; i * LOCAL_CHUNK < entries.length; i++) {
  const file = join(dir, "chunk-" + String(i).padStart(3, "0") + ".json");
  writeFileSync(file, JSON.stringify(entries.slice(i * LOCAL_CHUNK, (i + 1) * LOCAL_CHUNK)));
  wrangler("kv", "bulk", "put", file, "--binding", "POOL", "--local");
}
console.log("Seeded " + entries.length + " KV entries.");
