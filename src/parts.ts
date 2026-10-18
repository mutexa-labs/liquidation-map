import { RANKS, type Rank, type RankedAccount, type Ranking } from "./types";

/** Accounts of one part: `partSize` accounts starting at `part * partSize` of the chosen ranking. */
export function partOf(ranking: Ranking, rank: Rank, part: number, partSize: number): RankedAccount[] {
  return ranking[rank].slice(part * partSize, (part + 1) * partSize);
}

export type MapQuery = { ok: true; rank: Rank; part: number } | { ok: false; error: string };

/** Validates `?rank=&part=`; rank defaults to volume and part to 0. */
export function parseMapQuery(q: { rank?: string; part?: string }, parts: number): MapQuery {
  const rank = q.rank ?? "volume";
  if (!(RANKS as readonly string[]).includes(rank))
    return { ok: false, error: `rank must be one of ${RANKS.join(", ")}` };
  const part = q.part === undefined ? 0 : Number(q.part);
  if (!Number.isInteger(part) || part < 0 || part >= parts)
    return { ok: false, error: `part must be an integer from 0 to ${parts - 1}` };
  return { ok: true, rank: rank as Rank, part };
}
