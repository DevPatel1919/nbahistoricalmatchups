// Converts the generator's artifacts (data/processed/duel_pool/) into
// `wrangler kv bulk put` files in worker/.pool-kv/ (gitignored: they hold answers).
//
//   python scripts/generate_duel_pool.py            (repo root)
//   node scripts/build-pool-kv.mjs                  (worker/)
//   npx wrangler kv bulk put --binding POOL --remote .pool-kv/pool-000.json   (each file)

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WORKER_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const POOL_DIR = join(WORKER_DIR, "..", "data", "processed", "duel_pool");
const OUT_DIR = join(WORKER_DIR, ".pool-kv");
const CHUNK = 10_000; // wrangler kv bulk put accepts up to 10,000 pairs per file
const BANDS = ["lock", "favorite", "tossup"];

function load(name) {
  return JSON.parse(readFileSync(join(POOL_DIR, name + ".json"), "utf8"));
}

function main() {
  const entries = [];
  const indexes = new Map();
  const push = (key, id) => (indexes.has(key) ? indexes.get(key).push(id) : indexes.set(key, [id]));
  let version = null;

  for (const partition of ["sim", "ranked"]) {
    const pub = load(partition + "_public");
    const priv = load(partition + "_private");
    if (pub.version !== priv.version || (version && version !== pub.version)) throw new Error("Pool versions differ");
    version = pub.version;
    if (pub.puzzles.length !== priv.answers.length) throw new Error(partition + ": public/private length mismatch");

    pub.puzzles.forEach((view, i) => {
      const a = priv.answers[i];
      if (a.puzzleId !== view.puzzleId || a.partition !== partition) throw new Error(partition + ": records not aligned");
      const answer = {
        puzzleId: a.puzzleId,
        actualWinner: a.actualWinner,
        modelHomeWinProbability: a.modelHomeWinProbability,
        modelInSample: a.modelInSample,
        band: a.band,
        partition,
      };
      entries.push({ key: "pool:" + version + ":puzzle:" + view.puzzleId, value: JSON.stringify({ view, answer }) });
      if (partition === "sim" && BANDS.includes(a.band)) {
        push("sim:" + view.era + ":" + a.band, view.puzzleId);
        push("sim:all:" + a.band, view.puzzleId);
      }
      if (partition === "ranked") {
        push("ranked:" + view.era, view.puzzleId);
        push("ranked:all", view.puzzleId);
      }
    });
  }
  for (const [key, ids] of indexes) entries.push({ key: "pool:" + version + ":index:" + key, value: JSON.stringify(ids) });

  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });
  for (let i = 0; i * CHUNK < entries.length; i++) {
    const file = join(OUT_DIR, "pool-" + String(i).padStart(3, "0") + ".json");
    writeFileSync(file, JSON.stringify(entries.slice(i * CHUNK, (i + 1) * CHUNK)));
    console.log("Saved: " + file);
  }
  console.log("Pool " + version + ": " + entries.length + " KV entries. Set POOL_VERSION to " + version + ".");
}

main();
