import { describe, expect, it, vi } from "vitest";
import { createAsyncCache } from "../lib/async-cache";

describe("compiled-content cache", () => {
  it("deduplicates concurrent requests and reuses completed compilations", async () => {
    const cached = createAsyncCache<string>(2);
    const compile = vi.fn(async () => "compiled");
    expect(await Promise.all([cached("source-v1", compile), cached("source-v1", compile)])).toEqual(["compiled", "compiled"]);
    await cached("source-v1", compile);
    expect(compile).toHaveBeenCalledOnce();
    await cached("source-v2", compile);
    expect(compile).toHaveBeenCalledTimes(2);
  });
  it("retries failed compilations and bounds the cache using least-recent use", async () => {
    const cached = createAsyncCache<string>(2);
    await expect(cached("broken", async () => { throw new Error("invalid source"); })).rejects.toThrow("invalid source");
    expect(await cached("broken", async () => "fixed")).toBe("fixed");
    await cached("second", async () => "two");
    await cached("broken", async () => "should not run");
    await cached("third", async () => "three");
    const recompile = vi.fn(async () => "new two");
    expect(await cached("second", recompile)).toBe("new two");
    expect(recompile).toHaveBeenCalledOnce();
  });
});
