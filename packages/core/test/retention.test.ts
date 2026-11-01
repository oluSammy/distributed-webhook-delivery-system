import { describe, expect, it } from "vitest";
import { parseRetention } from "../src/retention.ts";

const valid = {
  ATTEMPT_RETENTION_DAYS: "7",
  DELIVERY_RETENTION_DAYS: "30",
  EVENT_RETENTION_DAYS: "33",
};

describe("parseRetention", () => {
  it("reads whole days", () => {
    expect(parseRetention(valid)).toEqual({ attemptDays: 7, deliveryDays: 30, eventDays: 33 });
  });

  it("rejects a missing, fractional or zero value", () => {
    expect(() => parseRetention({ ...valid, EVENT_RETENTION_DAYS: undefined })).toThrow(
      "EVENT_RETENTION_DAYS must be a whole number",
    );
    expect(() => parseRetention({ ...valid, ATTEMPT_RETENTION_DAYS: "2.5" })).toThrow(
      "ATTEMPT_RETENTION_DAYS must be a whole number",
    );
    expect(() => parseRetention({ ...valid, DELIVERY_RETENTION_DAYS: "0" })).toThrow(
      "DELIVERY_RETENTION_DAYS must be a whole number",
    );
  });

  it("keeps attempts for at least the longest retry window", () => {
    expect(() => parseRetention({ ...valid, ATTEMPT_RETENTION_DAYS: "2" })).toThrow(
      "ATTEMPT_RETENTION_DAYS must be at least 3",
    );
  });

  it("keeps events at least 3 days longer than deliveries", () => {
    expect(() => parseRetention({ ...valid, EVENT_RETENTION_DAYS: "32" })).toThrow(
      "EVENT_RETENTION_DAYS must be at least DELIVERY_RETENTION_DAYS + 3",
    );
    expect(
      parseRetention({ ...valid, DELIVERY_RETENTION_DAYS: "3", EVENT_RETENTION_DAYS: "6" }),
    ).toMatchObject({ deliveryDays: 3, eventDays: 6 });
  });
});
