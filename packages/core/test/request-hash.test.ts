import { describe, expect, it } from "vitest";
import { requestHash } from "../src/hash.ts";

describe("requestHash", () => {
  it("is the same for the same type and payload", async () => {
    expect(await requestHash("order.created", { id: 1 })).toEqual(
      await requestHash("order.created", { id: 1 }),
    );
  });

  it("changes when the payload changes", async () => {
    expect(await requestHash("order.created", { id: 1 })).not.toEqual(
      await requestHash("order.created", { id: 2 }),
    );
  });

  it("changes when the type changes", async () => {
    expect(await requestHash("order.created", { id: 1 })).not.toEqual(
      await requestHash("order.paid", { id: 1 }),
    );
  });

  it("treats a different key order as a different request", async () => {
    expect(await requestHash("t", { a: 1, b: 2 })).not.toEqual(
      await requestHash("t", { b: 2, a: 1 }),
    );
  });
});
