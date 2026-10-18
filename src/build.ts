import { createHyperliquidClient, type FetchLike, type HyperliquidClient } from "@mutexa/venue-adapters";
import { bucketize } from "./bucket";
import { fetchLeaderboard, LEADERBOARD_URL, rankLeaderboard } from "./leaderboard";
import { sampleAccounts } from "./sample";
import type { Buckets, MapPosition, Rank, RankedAccount } from "./types";

export type BuildOptions = {
  coin: string;
  rank: Rank;
  /** Accounts sampled from the top of the ranking. */
  top: number;
  /** Fraction of the mark on each side, for example 0.25 for ±25%. */
  range: number;
  buckets: number;
  concurrency: number;
  /** Most upstream reads for positions, retries included. */
  budget: number;
  attempts?: number;
  /** Fail when more than this share of the sample could not be read. */
  maxFailedShare?: number;
  fetch?: FetchLike;
  client?: Pick<HyperliquidClient, "clearinghouseState" | "allMids">;
  /** Leaderboard text stream; fetched from Hyperliquid when omitted. */
  leaderboard?: () => Promise<ReadableStream<string>>;
  now?: () => number;
};

export type LiquidationMap = {
  coin: string;
  mark: number;
  rank: Rank;
  top: number;
  leaderboardRows: number;
  accounts: RankedAccount[];
  failed: string[];
  readsUsed: number;
  /** Open positions on `coin` across the sampled accounts. */
  positions: MapPosition[];
  map: Buckets;
  fetchedAt: number;
  source: { leaderboard: string; positions: "clearinghouseState"; mark: "allMids" };
};

export class SampleError extends Error {
  override name = "SampleError";
}

/** Leaderboard → ranked sample → public positions → buckets for one coin. */
export async function buildLiquidationMap(o: BuildOptions): Promise<LiquidationMap> {
  const client = o.client ?? createHyperliquidClient({ fetch: o.fetch });
  const stream = o.leaderboard ? await o.leaderboard() : await fetchLeaderboard({ fetch: o.fetch });
  const ranking = await rankLeaderboard(stream, { top: o.top });
  const accounts = ranking[o.rank];
  const sample = await sampleAccounts(
    accounts.map((x) => x.a),
    { client, concurrency: o.concurrency, budget: o.budget, attempts: o.attempts },
  );
  const share = o.maxFailedShare ?? 0.5;
  if (sample.failed.length > accounts.length * share)
    throw new SampleError(`Hyperliquid did not answer for ${sample.failed.length} of ${accounts.length} accounts`);
  // the mark is read after the positions, so it is never older than they are
  const mids = await client.allMids();
  const mark = Number(mids[o.coin]);
  if (!(mark > 0)) throw new SampleError(`No mark price for ${o.coin}`);
  const positions = sample.positions.filter((p) => p.coin === o.coin);
  return {
    coin: o.coin,
    mark,
    rank: o.rank,
    top: o.top,
    leaderboardRows: ranking.rows,
    accounts,
    failed: sample.failed,
    readsUsed: sample.used,
    positions,
    map: bucketize(positions, mark, o.range, o.buckets),
    fetchedAt: (o.now ?? Date.now)(),
    source: { leaderboard: LEADERBOARD_URL, positions: "clearinghouseState", mark: "allMids" },
  };
}
