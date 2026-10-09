import { describe, expect, it } from "vitest";
import { firstRow } from "../src/rows.ts";

describe("firstRow", () => {
  it("returns the first row", () => {
    expect(firstRow([{ id: "a" }, { id: "b" }])).toEqual({ id: "a" });
  });

  it("throws when there are no rows", () => {
    expect(() => firstRow([])).toThrow("query returned no rows");
  });
});
