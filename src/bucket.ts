import type { Bucket, Buckets, MapPosition } from "./types";

/**
 * Buckets liquidatable notional by liquidation price within ±range of the mark. Longs liquidate below the mark,
 * shorts above. Positions without a liquidation price, or outside the range, are counted separately, so
 * inRange + outside + noLiq always equals the total of the positions passed in.
 */
export function bucketize(positions: readonly MapPosition[], mark: number, range: number, buckets: number): Buckets {
  if (!(mark > 0)) throw new RangeError("mark must be a positive number");
  if (!(range > 0 && range < 1)) throw new RangeError("range must be between 0 and 1");
  if (!Number.isInteger(buckets) || buckets < 1) throw new RangeError("buckets must be a positive integer");
  const lo = mark * (1 - range);
  const hi = mark * (1 + range);
  const step = (hi - lo) / buckets;
  const out: Bucket[] = Array.from({ length: buckets }, (_, i) => ({
    lo: lo + i * step,
    hi: lo + (i + 1) * step,
    longs: 0,
    shorts: 0,
    longCount: 0,
    shortCount: 0,
  }));
  let inRange = 0;
  let inRangeCount = 0;
  let outside = 0;
  let outsideCount = 0;
  let noLiq = 0;
  let noLiqCount = 0;
  for (const p of positions) {
    if (p.liq === null || !(p.liq > 0)) {
      noLiq += p.value;
      noLiqCount++;
      continue;
    }
    if (p.liq < lo || p.liq >= hi) {
      outside += p.value;
      outsideCount++;
      continue;
    }
    const b = out[Math.min(buckets - 1, Math.floor((p.liq - lo) / step))]!;
    if (p.szi > 0) {
      b.longs += p.value;
      b.longCount++;
    } else {
      b.shorts += p.value;
      b.shortCount++;
    }
    inRange += p.value;
    inRangeCount++;
  }
  return {
    buckets: out,
    step,
    lo,
    hi,
    inRange,
    inRangeCount,
    outside,
    outsideCount,
    noLiq,
    noLiqCount,
    total: inRange + outside + noLiq,
    totalCount: inRangeCount + outsideCount + noLiqCount,
  };
}

/** Bucket rows as CSV: lo, hi, longs, shorts, longCount, shortCount. */
export function bucketsToCsv(b: Pick<Buckets, "buckets">): string {
  const head = "lo,hi,longs_usd,shorts_usd,long_count,short_count";
  return (
    [head, ...b.buckets.map((x) => [x.lo, x.hi, x.longs, x.shorts, x.longCount, x.shortCount].join(","))].join("\n") +
    "\n"
  );
}
