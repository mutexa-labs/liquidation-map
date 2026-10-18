/** How the sample is chosen: 30-day traded volume (active traders) or account value (largest balances). */
export const RANKS = ["volume", "value"] as const;
export type Rank = (typeof RANKS)[number];

export type RankedAccount = {
  /** Account address, lowercase. */
  a: string;
  /** 1-based rank within the ranking. */
  rank: number;
  accountValue: number;
  monthVolume: number;
};

export type Ranking = {
  /** Leaderboard rows recognised in the stream. */
  rows: number;
  volume: RankedAccount[];
  value: RankedAccount[];
};

/** One open perp position, trimmed to what the map needs. */
export type MapPosition = {
  /** Account, lowercase. */
  a: string;
  coin: string;
  /** Signed size in coins. */
  szi: number;
  entryPx: number;
  /** Hyperliquid's reported liquidation price, or null when it reports none. */
  liq: number | null;
  /** Position value in USD at mark. */
  value: number;
  lev: number;
  cross: boolean;
};

export type Bucket = { lo: number; hi: number; longs: number; shorts: number; longCount: number; shortCount: number };

export type Buckets = {
  buckets: Bucket[];
  step: number;
  lo: number;
  hi: number;
  inRange: number;
  inRangeCount: number;
  outside: number;
  outsideCount: number;
  noLiq: number;
  noLiqCount: number;
  /** inRange + outside + noLiq: equals the summed value of every position passed in. */
  total: number;
  totalCount: number;
};

/** One part of a sample, as the Hono route returns it. */
export type MapPart = {
  rank: Rank;
  part: number;
  parts: number;
  sample: number;
  accounts: RankedAccount[];
  /** Accounts whose state could not be read within the budget. */
  failed: string[];
  positions: MapPosition[];
  leaderboardAt: number;
  fetchedAt: number;
  leaderboardRows: number;
};
