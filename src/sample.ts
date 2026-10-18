import { pool, type HlClearinghouseState, type HyperliquidClient } from "@mutexa/venue-adapters";
import type { MapPosition } from "./types";

export type SampleOptions = {
  client: Pick<HyperliquidClient, "clearinghouseState">;
  /** Reads in flight at once. */
  concurrency: number;
  /** Most upstream reads in total, retries included. Accounts left when it runs out are reported as failed. */
  budget: number;
  /** Most reads per account (first try plus retries). */
  attempts?: number;
};

export type SampleResult = {
  positions: MapPosition[];
  /** Accounts whose state could not be read within the budget. */
  failed: string[];
  /** Upstream reads used; never more than the budget. */
  used: number;
};

/** One account's open perp positions, trimmed to what the map needs. */
export function trimPositions(account: string, st: HlClearinghouseState): MapPosition[] {
  const out: MapPosition[] = [];
  for (const { position: p } of st.assetPositions ?? []) {
    const szi = Number(p.szi);
    if (!szi) continue;
    const liq = p.liquidationPx === null ? null : Number(p.liquidationPx);
    out.push({
      a: account.toLowerCase(),
      coin: p.coin,
      szi,
      entryPx: Number(p.entryPx),
      liq: liq !== null && Number.isFinite(liq) && liq > 0 ? liq : null,
      value: Number(p.positionValue),
      lev: p.leverage?.value ?? 0,
      cross: p.leverage?.type === "cross",
    });
  }
  return out;
}

/**
 * Reads each account's public `clearinghouseState` with a concurrency limit and a hard budget on upstream reads,
 * so a caller can stay inside a platform's subrequest limit. Positions keep the order of `accounts`.
 */
export async function sampleAccounts(accounts: readonly string[], opts: SampleOptions): Promise<SampleResult> {
  if (!Number.isInteger(opts.budget) || opts.budget < 0) throw new RangeError("budget must be a non-negative integer");
  const attempts = opts.attempts ?? 2;
  if (!Number.isInteger(attempts) || attempts < 1) throw new RangeError("attempts must be a positive integer");
  let left = opts.budget;
  let used = 0;
  const read = async (a: string): Promise<HlClearinghouseState | null> => {
    for (let i = 0; i < attempts; i++) {
      if (left <= 0) return null;
      left--;
      used++;
      try {
        return await opts.client.clearinghouseState(a);
      } catch {
        /* retry while attempts and budget remain */
      }
    }
    return null;
  };
  const states = await pool(accounts, opts.concurrency, read);
  const failed: string[] = [];
  const positions: MapPosition[] = [];
  states.forEach((st, i) => {
    const a = accounts[i]!;
    if (!st) failed.push(a.toLowerCase());
    else positions.push(...trimPositions(a, st));
  });
  return { positions, failed, used };
}
