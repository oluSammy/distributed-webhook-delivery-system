import { describe, expect, it } from "vitest";
import { resolveHost } from "../src/dns.ts";

// A stand-in for fetch that answers each record type from a table, and records what was asked.
function fakeDns(answers: Record<string, unknown>, status = 200) {
  const requested: string[] = [];
  const fetcher = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    requested.push(`${url.searchParams.get("name")} ${url.searchParams.get("type")}`);
    const type = url.searchParams.get("type") ?? "";
    return new Response(JSON.stringify(answers[type] ?? { Status: 0 }), { status });
  }) as typeof fetch;
  return { fetcher, requested };
}

describe("resolveHost", () => {
  it("returns the A and AAAA addresses, skipping CNAME records", async () => {
    const { fetcher, requested } = fakeDns({
      A: {
        Status: 0,
        Answer: [
          { type: 5, data: "hooks.example.net." },
          { type: 1, data: "93.184.216.34" },
        ],
      },
      AAAA: { Status: 0, Answer: [{ type: 28, data: "2606:2800:220:1::1" }] },
    });

    expect(await resolveHost("hooks.example.com", fetcher)).toEqual([
      "93.184.216.34",
      "2606:2800:220:1::1",
    ]);
    expect(requested.sort()).toEqual(["hooks.example.com A", "hooks.example.com AAAA"]);
  });

  it("returns nothing for a name that doesn't exist", async () => {
    const { fetcher } = fakeDns({ A: { Status: 3 }, AAAA: { Status: 3 } });
    expect(await resolveHost("nope.example.com", fetcher)).toEqual([]);
  });

  it("throws when the resolver fails", async () => {
    const { fetcher } = fakeDns({ A: { Status: 2 } });
    await expect(resolveHost("hooks.example.com", fetcher)).rejects.toThrow("DNS status 2");
  });

  it("throws on an HTTP error from the resolver", async () => {
    const { fetcher } = fakeDns({}, 503);
    await expect(resolveHost("hooks.example.com", fetcher)).rejects.toThrow("HTTP 503");
  });
});
