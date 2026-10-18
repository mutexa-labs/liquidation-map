// Optional: a mountable Hono route that serves one part of the sample per request (requires `hono`).
//
//   app.route("/api/liquidation-map", createLiquidationMapRoute({ partSize: 32, parts: 3, budget: 47 }));
//   GET /api/liquidation-map?rank=volume&part=0
//
// Splitting the sample into parts keeps each request inside a platform's subrequest limit: one leaderboard fetch
// (cached) plus at most `budget` position reads.

import { createCache, createHyperliquidClient, type FetchLike, type Memo } from "@mutexa/venue-adapters";
import { Hono, type Context } from "hono";
import { fetchLeaderboard, rankLeaderboard } from "./leaderboard";
import { parseMapQuery, partOf } from "./parts";
import { sampleAccounts } from "./sample";
import type { MapPart, Rank, Ranking } from "./types";

export type LiquidationMapRouteOptions = {
  /** Accounts per part. */
  partSize: number;
  /** Number of parts; the sample is partSize × parts accounts. */
  parts: number;
  /** Most position reads per request, retries included. */
  budget: number;
  concurrency?: number;
  attempts?: number;
  /** Fail a part when more than this share of its accounts could not be read. */
  maxFailedShare?: number;
  /** How long the leaderboard ranking is reused, in ms. */
  leaderboardTtlMs?: number;
  /** How long a part is reused, in ms. */
  partTtlMs?: number;
  fetch?: FetchLike;
  cache?: Memo;
  /** Return false to answer 401. Use it to keep the upstream fan-out behind your own sign-in. */
  authorize?: (c: Context) => boolean | Promise<boolean>;
};

export function createLiquidationMapRoute(o: LiquidationMapRouteOptions) {
  const memo = o.cache ?? createCache();
  const client = createHyperliquidClient({ fetch: o.fetch, cache: false });
  const sample = o.partSize * o.parts;
  const ranking = () =>
    memo.cached("liquidation-map:leaderboard", o.leaderboardTtlMs ?? 3_600_000, async () =>
      rankLeaderboard(await fetchLeaderboard({ fetch: o.fetch }), { top: sample }),
    );

  const build = async (rank: Rank, part: number): Promise<MapPart> => {
    const lb = await ranking();
    const r: Ranking = lb.value;
    const accounts = partOf(r, rank, part, o.partSize);
    const s = await sampleAccounts(
      accounts.map((x) => x.a),
      { client, concurrency: o.concurrency ?? 4, budget: o.budget, attempts: o.attempts },
    );
    if (s.failed.length > accounts.length * (o.maxFailedShare ?? 0.5))
      throw new Error(`Hyperliquid did not answer for ${s.failed.length} of ${accounts.length} accounts`);
    return {
      rank,
      part,
      parts: o.parts,
      sample,
      accounts,
      failed: s.failed,
      positions: s.positions,
      leaderboardAt: lb.at,
      fetchedAt: Date.now(),
      leaderboardRows: r.rows,
    };
  };

  return new Hono().get("/", async (c) => {
    if (o.authorize && !(await o.authorize(c))) return c.json({ error: "Not authorized" }, 401);
    const q = parseMapQuery({ rank: c.req.query("rank"), part: c.req.query("part") }, o.parts);
    if (!q.ok) return c.json({ error: q.error }, 400);
    try {
      const r = await memo.cached(`liquidation-map:${q.rank}:${q.part}`, o.partTtlMs ?? 300_000, () =>
        build(q.rank, q.part),
      );
      return c.json(r.value, 200, { "cache-control": "no-store", "x-cache": r.hit ? "hit" : "miss" });
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : "Upstream error" }, 502);
    }
  });
}
