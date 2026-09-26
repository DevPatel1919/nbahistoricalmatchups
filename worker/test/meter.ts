// Metering wrappers for the cost profile (F09 Session 8). They count what
// Cloudflare bills: D1 queries, rows read and rows written (from each result's
// meta), and KV reads, writes, and deletes. Behaviour is unchanged, except that
// `first()` runs as `all()` so its meta can be read; the rows it reads are the
// same.

import { env } from "cloudflare:test";

export type Usage = { d1Queries: number; rowsRead: number; rowsWritten: number; kvReads: number; kvWrites: number; kvDeletes: number };

export const emptyUsage = (): Usage => ({ d1Queries: 0, rowsRead: 0, rowsWritten: 0, kvReads: 0, kvWrites: 0, kvDeletes: 0 });

type Meta = { rows_read?: number; rows_written?: number };

const REAL = new WeakMap<object, D1PreparedStatement>();

function meterStatement(stmt: D1PreparedStatement, usage: Usage): D1PreparedStatement {
  const count = (meta: Meta | undefined) => {
    usage.d1Queries++;
    usage.rowsRead += meta?.rows_read ?? 0;
    usage.rowsWritten += meta?.rows_written ?? 0;
  };
  const wrapped = {
    bind: (...values: unknown[]) => meterStatement(stmt.bind(...values), usage),
    async first(column?: string) {
      const r = await stmt.all<Record<string, unknown>>();
      count(r.meta as Meta);
      const row = r.results[0] ?? null;
      return column ? (row?.[column] ?? null) : row;
    },
    async all() {
      const r = await stmt.all();
      count(r.meta as Meta);
      return r;
    },
    async run() {
      const r = await stmt.run();
      count(r.meta as Meta);
      return r;
    },
    async raw(options?: { columnNames?: boolean }) {
      usage.d1Queries++;
      return stmt.raw(options as { columnNames: true });
    },
  } as unknown as D1PreparedStatement;
  REAL.set(wrapped, stmt);
  return wrapped;
}

function meterDb(db: D1Database, usage: Usage): D1Database {
  return {
    prepare: (sql: string) => meterStatement(db.prepare(sql), usage),
    async batch(statements: D1PreparedStatement[]) {
      const results = await db.batch(statements.map((s) => REAL.get(s) ?? s));
      for (const r of results) {
        usage.d1Queries++;
        usage.rowsRead += (r.meta as Meta).rows_read ?? 0;
        usage.rowsWritten += (r.meta as Meta).rows_written ?? 0;
      }
      return results;
    },
    exec: (sql: string) => db.exec(sql),
    dump: () => db.dump(),
    withSession: (...args: unknown[]) => (db.withSession as (...a: unknown[]) => D1DatabaseSession)(...args),
  } as unknown as D1Database;
}

function meterKv(kv: KVNamespace, usage: Usage): KVNamespace {
  return new Proxy(kv, {
    get(target, prop) {
      const value = Reflect.get(target, prop);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        if (prop === "get" || prop === "getWithMetadata") usage.kvReads++;
        if (prop === "put") usage.kvWrites++;
        if (prop === "delete") usage.kvDeletes++;
        return value.apply(target, args);
      };
    },
  });
}

/** A copy of the test env whose D1 and KV bindings add to `usage`. */
export function meteredEnv(usage: Usage, overrides: Partial<typeof env> = {}): typeof env {
  return {
    ...env,
    ...overrides,
    DB: meterDb(env.DB, usage),
    POOL: meterKv(env.POOL, usage),
    RATE_LIMITS: meterKv(env.RATE_LIMITS, usage),
  };
}

/** Runs `fn` against a metered env and returns what it used. */
export async function measure(fn: (metered: typeof env) => Promise<unknown>, overrides: Partial<typeof env> = {}): Promise<Usage> {
  const usage = emptyUsage();
  await fn(meteredEnv(usage, overrides));
  return usage;
}
