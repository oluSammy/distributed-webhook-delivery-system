// What one delivery attempt's result means
export type Outcome = "success" | "failure" | "throttled" | "non_retryable";

// The values allowed in delivery_attempts.error_kind
export type ErrorKind =
  | "timeout"
  | "dns"
  | "tls"
  | "conn_refused"
  | "redirect"
  | "http_4xx"
  | "http_5xx";

export type AttemptResult =
  | { kind: "response"; status: number; retryAfter: string | null }
  | { kind: "error"; error: unknown };

export type Classification = {
  outcome: Outcome;
  errorKind: ErrorKind | null;
  deadReason: string | null; // set for non_retryable only
  retryAfterSeconds: number | null; // set for throttled only, when the response says
};

export function classify(result: AttemptResult, now: Date): Classification {
  if (result.kind === "error") {
    return failure(errorKindOf(result.error));
  }

  const { status } = result;
  if (status >= 200 && status < 300) {
    return { outcome: "success", errorKind: null, deadReason: null, retryAfterSeconds: null };
  }
  const retryAfter = parseRetryAfter(result.retryAfter, now);
  if (status === 429 || (status === 503 && retryAfter !== null)) {
    return {
      outcome: "throttled",
      errorKind: status === 429 ? "http_4xx" : "http_5xx",
      deadReason: null,
      retryAfterSeconds: retryAfter,
    };
  }
  if (status >= 300 && status < 400) {
    return failure("redirect");
  }
  if (status === 408) {
    return failure("http_4xx");
  }
  if (status >= 400 && status < 500) {
    return {
      outcome: "non_retryable",
      errorKind: "http_4xx",
      deadReason: status === 410 ? "gone" : "http_4xx",
      retryAfterSeconds: null,
    };
  }
  return failure("http_5xx");
}

function failure(errorKind: ErrorKind): Classification {
  return { outcome: "failure", errorKind, deadReason: null, retryAfterSeconds: null };
}

// Workers report every network failure with the same opaque errors ("Network connection lost.",
// "internal error; reference = …"), so only a timeout can be told apart from the rest.
function errorKindOf(error: unknown): ErrorKind {
  return error instanceof Error && error.name === "TimeoutError" ? "timeout" : "conn_refused";
}

// Retry-After is either a number of seconds or an HTTP date. Returns whole seconds from now,
// or null when the header is missing or unreadable.
export function parseRetryAfter(value: string | null, now: Date): number | null {
  if (value === null) {
    return null;
  }
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed);
  }
  // HTTP dates end in GMT; checking that stops Date.parse from reading "-5" as a year.
  const date = trimmed.endsWith("GMT") ? Date.parse(trimmed) : Number.NaN;
  if (Number.isNaN(date)) {
    return null;
  }
  return Math.max(0, Math.ceil((date - now.getTime()) / 1000));
}
