// DNS over HTTPS (RFC 8484, JSON form) against Cloudflare's public resolver.
// Workers have no raw DNS, so name lookups go through an ordinary HTTPS request.

const DOH_URL = "https://cloudflare-dns.com/dns-query";
const LOOKUP_TIMEOUT_MS = 3000;

const RECORD_TYPES = { A: 1, AAAA: 28 } as const;
type RecordType = keyof typeof RECORD_TYPES;

const NOERROR = 0;
const NXDOMAIN = 3;

type DnsJsonResponse = {
  Status: number;
  Answer?: { type: number; data: string }[];
};

export type Resolver = (host: string) => Promise<string[]>;

export async function resolveHost(host: string, fetcher: typeof fetch = fetch): Promise<string[]> {
  const [ipv4, ipv6] = await Promise.all([
    lookup(host, "A", fetcher),
    lookup(host, "AAAA", fetcher),
  ]);
  return [...ipv4, ...ipv6];
}

async function lookup(host: string, type: RecordType, fetcher: typeof fetch) {
  const url = `${DOH_URL}?name=${encodeURIComponent(host)}&type=${type}`;
  const response = await fetcher(url, {
    headers: { accept: "application/dns-json" },
    signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`DNS lookup for ${host} failed with HTTP ${response.status}`);
  }

  const body = (await response.json()) as DnsJsonResponse;
  if (body.Status === NXDOMAIN) {
    return [];
  }

  if (body.Status !== NOERROR) {
    throw new Error(`DNS lookup for ${host} failed with DNS status ${body.Status}`);
  }
  return (body.Answer ?? [])
    .filter((record) => record.type === RECORD_TYPES[type])
    .map((record) => record.data);
}
