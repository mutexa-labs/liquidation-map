import type { HlClearinghouseState } from "@mutexa/venue-adapters";
import { describe, expect, it } from "vitest";
import { sampleAccounts, trimPositions } from "../src/index";
import { stateOf, states } from "./helpers/fixtures";

const accounts = states.accounts;
const empty: HlClearinghouseState = { assetPositions: [], time: 0 } as unknown as HlClearinghouseState;

/** A client whose reads fail for the accounts in `down` (always) or on their first try (`flaky`). */
function client(opts: { down?: Set<string>; flaky?: Set<string>; delay?: number } = {}) {
  let calls = 0;
  let active = 0;
  let peak = 0;
  const seen = new Map<string, number>();
  return {
    get calls() {
      return calls;
    },
    get peak() {
      return peak;
    },
    async clearinghouseState(a: string) {
      calls++;
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, opts.delay ?? 1));
      active--;
      const n = (seen.get(a) ?? 0) + 1;
      seen.set(a, n);
      if (opts.down?.has(a) || (opts.flaky?.has(a) && n === 1)) throw new Error("upstream");
      return a.startsWith("0x000000000000000000000000000000000000c0") ? stateOf(a) : empty;
    },
  };
}

describe("trimPositions", () => {
  it("keeps open positions with parsed numbers and a null liquidation price where there is none", () => {
    const a = accounts.find((x) => stateOf(x).assetPositions.length > 10)!;
    const st = stateOf(a);
    const ps = trimPositions(a, st);
    expect(ps).toHaveLength(st.assetPositions.filter((p) => Number(p.position.szi) !== 0).length);
    for (const p of ps) {
      expect(p.a).toBe(a);
      expect(p.value).toBeGreaterThan(0);
      if (p.liq !== null) expect(p.liq).toBeGreaterThan(0);
    }
    expect(ps.some((p) => p.liq === null)).toBe(true);
  });
});

describe("sampleAccounts", () => {
  it("reads every account once when nothing fails", async () => {
    const c = client();
    const r = await sampleAccounts(accounts, { client: c, concurrency: 3, budget: 100 });
    expect(r.failed).toEqual([]);
    expect(r.used).toBe(accounts.length);
    expect(c.calls).toBe(accounts.length);
    expect(c.peak).toBeLessThanOrEqual(3);
    expect(r.positions.length).toBe(accounts.reduce((n, a) => n + trimPositions(a, stateOf(a)).length, 0));
  });

  it("never exceeds the budget, whatever fails", async () => {
    for (const budget of [0, 1, 3, accounts.length, accounts.length + 2, 3 * accounts.length])
      for (const scenario of [
        {},
        { down: new Set(accounts) },
        { flaky: new Set(accounts) },
        { down: new Set(accounts.slice(0, 3)) },
      ]) {
        const c = client(scenario);
        const r = await sampleAccounts(accounts, { client: c, concurrency: 4, budget, attempts: 3 });
        expect(c.calls).toBeLessThanOrEqual(budget);
        expect(r.used).toBe(c.calls);
        expect(r.failed.length + accounts.filter((a) => !r.failed.includes(a)).length).toBe(accounts.length);
      }
  });

  it("retries a failed read while attempts and budget remain", async () => {
    const flaky = new Set(accounts.slice(0, 2));
    const r = await sampleAccounts(accounts, { client: client({ flaky }), concurrency: 2, budget: 100, attempts: 2 });
    expect(r.failed).toEqual([]);
    expect(r.used).toBe(accounts.length + 2);
    const once = await sampleAccounts(accounts, {
      client: client({ flaky }),
      concurrency: 2,
      budget: 100,
      attempts: 1,
    });
    expect(once.failed.sort()).toEqual([...flaky].sort());
  });

  it("reports accounts left without budget as failed", async () => {
    const r = await sampleAccounts(accounts, { client: client(), concurrency: 1, budget: 3 });
    expect(r.used).toBe(3);
    expect(r.failed).toEqual(accounts.slice(3));
  });

  it("validates its options", async () => {
    await expect(sampleAccounts(accounts, { client: client(), concurrency: 1, budget: -1 })).rejects.toThrow(
      RangeError,
    );
    await expect(
      sampleAccounts(accounts, { client: client(), concurrency: 1, budget: 1, attempts: 0 }),
    ).rejects.toThrow(RangeError);
  });
});
