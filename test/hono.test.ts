import { describe, expect, it } from "vitest";
import { createLiquidationMapRoute } from "../src/hono";
import { fakeFetch, states } from "./helpers/fixtures";

describe("liquidation map route", () => {
  it("serves parts of the sample and caches them", async () => {
    const f = fakeFetch();
    const app = createLiquidationMapRoute({ partSize: 20, parts: 2, budget: 40, fetch: f });
    const a = await app.request("/?rank=volume&part=0");
    expect(a.status).toBe(200);
    expect(a.headers.get("x-cache")).toBe("miss");
    const p0 = (await a.json()) as {
      accounts: { a: string; rank: number }[];
      parts: number;
      sample: number;
      failed: string[];
    };
    expect(p0).toMatchObject({ parts: 2, sample: 40, failed: [] });
    expect(p0.accounts.map((x) => x.rank)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    const p1 = (await (await app.request("/?part=1")).json()) as { accounts: { a: string }[] };
    expect([...p0.accounts, ...p1.accounts].map((x) => x.a).sort()).toEqual([...states.accounts].sort());
    expect((await app.request("/?rank=volume&part=0")).headers.get("x-cache")).toBe("hit");
    expect(f.calls).toHaveLength(40);
  });

  it("validates the query and can require authorization", async () => {
    const app = createLiquidationMapRoute({
      partSize: 20,
      parts: 2,
      budget: 40,
      fetch: fakeFetch(),
      authorize: (c) => c.req.header("x-ok") === "1",
    });
    expect((await app.request("/")).status).toBe(401);
    expect((await app.request("/?part=2", { headers: { "x-ok": "1" } })).status).toBe(400);
    expect((await app.request("/", { headers: { "x-ok": "1" } })).status).toBe(200);
  });

  it("answers 502 when the leaderboard cannot be read", async () => {
    const app = createLiquidationMapRoute({
      partSize: 4,
      parts: 2,
      budget: 8,
      fetch: fakeFetch({ leaderboard: "{}" }),
    });
    const r = await app.request("/");
    expect(r.status).toBe(502);
    expect(((await r.json()) as { error: string }).error).toMatch(/format not recognised/);
  });
});
