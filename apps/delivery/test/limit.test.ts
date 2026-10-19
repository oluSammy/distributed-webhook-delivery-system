import { describe, expect, it } from "vitest";
import { forEachLimited } from "../src/limit";

describe("forEachLimited", () => {
  it("runs every item, never more than the limit at once", async () => {
    let running = 0;
    let maxRunning = 0;
    const done: number[] = [];

    await forEachLimited([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 6, async (item) => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((resolve) => setTimeout(resolve, 10));
      done.push(item);
      running--;
    });

    expect(maxRunning).toBe(6);
    expect(done.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("does nothing for an empty list", async () => {
    await forEachLimited([], 6, async () => {
      throw new Error("should not run");
    });
  });
});
