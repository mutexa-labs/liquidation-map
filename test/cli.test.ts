import { describe, expect, it } from "vitest";
import { buildLiquidationMap, parseArgs, run, SampleError } from "../src/index";
import { fakeFetch, states } from "./helpers/fixtures";

const NOW = Date.parse("2026-10-18T00:00:00Z");

function io() {
  const files = new Map<string, string>();
  let out = "";
  let err = "";
  return {
    files,
    get out() {
      return out;
    },
    get err() {
      return err;
    },
    io: {
      fetch: fakeFetch(),
      writeFile: async (p: string, d: string) => void files.set(p, d),
      stdout: (s: string) => void (out += s),
      stderr: (s: string) => void (err += s),
      now: () => NOW,
    },
  };
}

describe("liquidation-map CLI", () => {
  it("writes JSON and CSV for one coin, with totals that reconcile", async () => {
    const t = io();
    const code = await run(
      ["--coin", "BTC", "--top", "40", "--buckets", "10", "--out", "map.json", "--csv", "map.csv"],
      t.io,
    );
    expect(code).toBe(0);
    const m = JSON.parse(t.files.get("map.json")!);
    expect(m.accounts.map((a: { a: string }) => a.a).sort()).toEqual([...states.accounts].sort());
    expect(m.failed).toEqual([]);
    expect(m.readsUsed).toBe(40);
    expect(m.map.inRangeCount).toBeGreaterThan(0);
    expect(m.map.inRange + m.map.outside + m.map.noLiq).toBeCloseTo(m.map.total, 6);
    expect(m.source.positions).toBe("clearinghouseState");
    expect(t.files.get("map.csv")!.split("\n")[0]).toBe("lo,hi,longs_usd,shorts_usd,long_count,short_count");
    expect(t.out).toBe("");
    expect(t.err).toMatchSnapshot();
    expect(m).toMatchSnapshot();
  });

  it("prints JSON to stdout without --out", async () => {
    const t = io();
    expect(
      await run(["--coin", "BTC", "--top", "40", "--rank", "value", "--range", "0.5", "--buckets", "4"], t.io),
    ).toBe(0);
    const m = JSON.parse(t.out);
    expect(m).toMatchObject({ coin: "BTC", rank: "value", top: 40 });
    expect(m.map.buckets).toHaveLength(4);
  });

  it("explains usage errors with exit code 2", async () => {
    for (const argv of [
      [],
      ["--coin", "BTC"],
      ["--coin", "BTC", "--top", "0"],
      ["--coin", "BTC", "--top", "5", "--rank", "pnl"],
      ["--nope", "1"],
      ["BTC"],
    ]) {
      const t = io();
      expect(await run(argv, t.io)).toBe(2);
      expect(t.err).toContain("Usage:");
    }
    const h = io();
    expect(await run(["--help"], h.io)).toBe(0);
    expect(h.out).toMatchSnapshot();
  });

  it("defaults the budget to two reads per account", () => {
    expect(parseArgs(["--coin=BTC", "--top=10"])).toMatchObject({
      budget: 20,
      range: 0.25,
      buckets: 60,
      concurrency: 4,
      attempts: 2,
      rank: "volume",
    });
  });

  it("exits 1 with a readable error when the sample cannot be read", async () => {
    const t = io();
    t.io.fetch = Object.assign(
      async (url: string, init?: RequestInit) =>
        url.includes("leaderboard") ? fakeFetch()(url, init) : new Response("down", { status: 500 }),
      { calls: [] },
    );
    expect(await run(["--coin", "BTC", "--top", "40"], t.io)).toBe(1);
    expect(t.err).toMatch(/^error: Hyperliquid did not answer for 40 of 40 accounts/);
  });
});

describe("buildLiquidationMap", () => {
  it("fails on a coin without a mark price", async () => {
    await expect(
      buildLiquidationMap({
        coin: "NOPE",
        rank: "volume",
        top: 40,
        range: 0.25,
        buckets: 10,
        concurrency: 4,
        budget: 80,
        fetch: fakeFetch(),
      }),
    ).rejects.toThrow(SampleError);
  });
});
