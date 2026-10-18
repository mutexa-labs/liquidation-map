import { describe, expect, it } from "vitest";
import { bucketize, bucketsToCsv, trimPositions, type MapPosition } from "../src/index";
import { stateOf, states } from "./helpers/fixtures";

const all = states.accounts.flatMap((a) => trimPositions(a, stateOf(a)));
const mids = states.exchanges.find((e) => (e.request as { type: string }).type === "allMids")!.response as Record<
  string,
  string
>;
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe("bucketize", () => {
  it("reconciles on every recorded coin, range and bucket count", () => {
    const coins = [...new Set(all.map((p) => p.coin))];
    expect(coins.length).toBeGreaterThan(5);
    for (const coin of coins) {
      const ps = all.filter((p) => p.coin === coin);
      const mark = Number(mids[coin]);
      for (const range of [0.1, 0.25, 0.5])
        for (const n of [1, 30, 60]) {
          const b = bucketize(ps, mark, range, n);
          const inBuckets = sum(b.buckets.map((x) => x.longs + x.shorts));
          expect(inBuckets).toBeCloseTo(b.inRange, 6);
          expect(b.total).toBeCloseTo(sum(ps.map((p) => p.value)), 6);
          expect(b.inRangeCount + b.outsideCount + b.noLiqCount).toBe(ps.length);
          expect(sum(b.buckets.map((x) => x.longCount + x.shortCount))).toBe(b.inRangeCount);
        }
    }
  });

  it("reconciles on random positions", () => {
    let s = 17;
    const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
    for (let k = 0; k < 50; k++) {
      const ps: MapPosition[] = Array.from({ length: 40 }, (_, i) => ({
        a: `a${i}`,
        coin: "X",
        szi: r() > 0.5 ? 1 : -1,
        entryPx: 100,
        liq: r() < 0.2 ? null : r() * 300,
        value: r() * 1e6,
        lev: 5,
        cross: r() > 0.5,
      }));
      const b = bucketize(ps, 100, 0.3, 1 + Math.floor(r() * 80));
      expect(b.inRange + b.outside + b.noLiq).toBeCloseTo(sum(ps.map((p) => p.value)), 3);
      expect(sum(b.buckets.map((x) => x.longs + x.shorts))).toBeCloseTo(b.inRange, 3);
    }
  });

  it("puts longs and shorts on their own sides of each bucket and handles the edges", () => {
    const p = (liq: number | null, szi: number, value = 1): MapPosition => ({
      a: "a",
      coin: "X",
      szi,
      entryPx: 100,
      liq,
      value,
      lev: 1,
      cross: false,
    });
    const b = bucketize(
      [p(80, 1, 2), p(120, -1, 3), p(90, 1), p(110, -1), p(null, 1, 7), p(0, 1, 5), p(200, -1, 11)],
      100,
      0.2,
      4,
    );
    expect(b.lo).toBe(80);
    expect(b.hi).toBe(120);
    expect(b.buckets[0]).toMatchObject({ longs: 2, longCount: 1, shorts: 0 }); // liq == lo is inside
    expect(b.buckets[1]).toMatchObject({ longs: 1 });
    expect(b.buckets[3]).toMatchObject({ shorts: 1 });
    expect(b.outside).toBe(3 + 11); // liq == hi and beyond
    expect(b.noLiq).toBe(7 + 5); // null and non-positive
    expect(b.total).toBe(2 + 3 + 1 + 1 + 7 + 5 + 11);
  });

  it("validates its inputs", () => {
    expect(() => bucketize([], 0, 0.2, 10)).toThrow(RangeError);
    expect(() => bucketize([], 100, 1, 10)).toThrow(RangeError);
    expect(() => bucketize([], 100, 0.2, 0)).toThrow(RangeError);
  });

  it("writes buckets as CSV", () => {
    const csv = bucketsToCsv(bucketize([], 100, 0.5, 2));
    expect(csv).toBe("lo,hi,longs_usd,shorts_usd,long_count,short_count\n50,100,0,0,0,0\n100,150,0,0,0,0\n");
  });
});
