import { describe, expect, it } from "vitest";
import { classify, parseRetryAfter } from "../src/classify.ts";

const now = new Date("2026-10-19T12:00:00Z");

function response(status: number, retryAfter: string | null = null) {
  return classify({ kind: "response", status, retryAfter }, now);
}

describe("classify", () => {
  it("treats 2xx as success", () => {
    expect(response(200).outcome).toBe("success");
    expect(response(204).outcome).toBe("success");
  });

  it("retries 5xx, 408 and redirects", () => {
    expect(response(500)).toMatchObject({ outcome: "failure", errorKind: "http_5xx" });
    expect(response(503)).toMatchObject({ outcome: "failure", errorKind: "http_5xx" });
    expect(response(408)).toMatchObject({ outcome: "failure", errorKind: "http_4xx" });
    expect(response(302)).toMatchObject({ outcome: "failure", errorKind: "redirect" });
  });

  it("treats 429, and 503 with Retry-After, as throttled", () => {
    expect(response(429)).toMatchObject({ outcome: "throttled", retryAfterSeconds: null });
    expect(response(429, "120")).toMatchObject({ outcome: "throttled", retryAfterSeconds: 120 });
    expect(response(503, "30")).toMatchObject({ outcome: "throttled", errorKind: "http_5xx" });
  });

  it("gives up on 410 and other 4xx, with distinct reasons", () => {
    expect(response(410)).toMatchObject({ outcome: "non_retryable", deadReason: "gone" });
    expect(response(400)).toMatchObject({ outcome: "non_retryable", deadReason: "http_4xx" });
    expect(response(404)).toMatchObject({ outcome: "non_retryable", deadReason: "http_4xx" });
  });

  it("retries network errors, and recognises timeouts", () => {
    const timeout = new DOMException("The operation was aborted due to timeout", "TimeoutError");
    expect(classify({ kind: "error", error: timeout }, now)).toMatchObject({
      outcome: "failure",
      errorKind: "timeout",
    });
    expect(
      classify({ kind: "error", error: new Error("Network connection lost.") }, now),
    ).toMatchObject({ outcome: "failure", errorKind: "conn_refused" });
  });
});

describe("parseRetryAfter", () => {
  it("reads seconds and HTTP dates", () => {
    expect(parseRetryAfter("90", now)).toBe(90);
    expect(parseRetryAfter(" 5 ", now)).toBe(5);
    expect(parseRetryAfter("Mon, 19 Oct 2026 12:02:00 GMT", now)).toBe(120);
  });

  it("treats a past date as now, and nonsense as missing", () => {
    expect(parseRetryAfter("Mon, 19 Oct 2026 11:00:00 GMT", now)).toBe(0);
    expect(parseRetryAfter("soon", now)).toBeNull();
    expect(parseRetryAfter("-5", now)).toBeNull();
    expect(parseRetryAfter(null, now)).toBeNull();
  });
});
