// Command-line client for the integrity review queue (src/admin.ts). Flags
// never ban anyone: clearing puts the account back on the leaderboard, and
// upholding keeps it off. Play and rating are unaffected either way.
//
//   DUEL_API=https://<worker-host> ADMIN_TOKEN=<secret> node scripts/review-queue.mjs list [open|cleared|upheld]
//   DUEL_API=... ADMIN_TOKEN=... node scripts/review-queue.mjs clear  <flagId> "<note>"
//   DUEL_API=... ADMIN_TOKEN=... node scripts/review-queue.mjs uphold <flagId> "<note>"
//   DUEL_API=... ADMIN_TOKEN=... node scripts/review-queue.mjs sweep
//
// Keep ADMIN_TOKEN out of shell history (e.g. read it from a password manager).

const api = (process.env.DUEL_API ?? "").replace(/\/+$/, "");
const token = process.env.ADMIN_TOKEN ?? "";
const [command, arg, note] = process.argv.slice(2);

if (!api || !token || !["list", "clear", "uphold", "sweep"].includes(command)) {
  console.error("Usage: DUEL_API=... ADMIN_TOKEN=... node scripts/review-queue.mjs list [status] | clear <id> [note] | uphold <id> [note] | sweep");
  process.exit(2);
}

async function request(path, body) {
  const response = await fetch(api + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { authorization: "Bearer " + token, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    // A wrong token and a missing endpoint both answer 404 on purpose.
    console.error("HTTP " + response.status + ": " + (payload?.message ?? "no body"));
    process.exit(1);
  }
  return payload;
}

if (command === "list") {
  const { flags } = await request("/v1/admin/flags?status=" + encodeURIComponent(arg ?? "open"));
  if (flags.length === 0) console.log("No " + (arg ?? "open") + " flags.");
  for (const f of flags) {
    console.log(
      [
        f.id,
        f.kind,
        (f.displayName ?? "(no name)") + " [" + f.accountId + "]",
        f.relatedAccountId ? "with " + (f.relatedDisplayName ?? "(no name)") + " [" + f.relatedAccountId + "]" : "",
        "rating " + (f.account.rating ?? "none") + " over " + f.account.ratedDuels + " rated duels",
        "raised " + new Date(f.createdAt).toISOString(),
        f.reviewNote ? "note: " + f.reviewNote : "",
      ]
        .filter(Boolean)
        .join(" | "),
    );
    console.log("    evidence " + JSON.stringify(f.evidence));
  }
} else if (command === "sweep") {
  console.log(await request("/v1/admin/sweep", {}));
} else {
  if (!arg) {
    console.error("A flag id is required.");
    process.exit(2);
  }
  const flag = await request("/v1/admin/flags/" + encodeURIComponent(arg), { decision: command, note });
  console.log(flag.id + " is now " + flag.status + ".");
}
