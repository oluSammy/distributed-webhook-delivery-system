export type UrlPolicy = {
  allowLocal: boolean; // plain http and local addresses are allowed during development
};

const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".home.arpa"];

// IPv4 ranges that must never be a webhook target: [first address, prefix length]
const BLOCKED_IPV4: [string, number][] = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // carrier-grade NAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, including cloud metadata 169.254.169.254
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved, including broadcast
];

// IPv6 ranges: [first address, prefix length]
const BLOCKED_IPV6: [string, number][] = [
  ["::", 128], // unspecified
  ["::1", 128], // loopback
  ["100::", 64], // discard
  ["2001:db8::", 32], // documentation
  ["fc00::", 7], // unique local (private), including fd00:ec2::254 metadata
  ["fe80::", 10], // link-local
  ["ff00::", 8], // multicast
];

/**
 Why checking the parsed url.hostname matters: the URL parser normalises the classic tricks before we see them.
 2130706433, 0x7f.1 and 127.1 all become 127.0.0.1, and [::ffff:127.0.0.1] becomes [::ffff:7f00:1]. If
we checked the raw string, all of those would bypass a 127.0.0.1 check. We check what fetch will actually connect to.
 */

export function checkEndpointUrl(raw: string, policy: UrlPolicy): string | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "not a valid URL";
  }

  // ftp:, file:, gopher: and everything else is always rejected
  if (url.protocol !== "https:" && !(policy.allowLocal && url.protocol === "http:")) {
    return "must use https";
  }

  // https://user:pass@host/ - credentials not allowed
  if (url.username !== "" || url.password !== "") {
    return "must not contain credentials";
  }

  // in local dev, stop here and allow private addresses
  if (policy.allowLocal) {
    return null;
  }

  const host = url.hostname.replace(/\.$/, "").toLowerCase();
  if (host === "localhost" || BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    return "must not point at a local host name";
  }

  // block Addresses written as IPs
  if (isBlockedAddress(host)) {
    return "must not point at a private, loopback or reserved address";
  }
  return null;
}

export function isBlockedAddress(host: string): boolean {
  const ipv4 = parseIPv4(host);
  if (ipv4 !== null) {
    return BLOCKED_IPV4.some(([base, bits]) => inRange(ipv4, parseIPv4(base) ?? 0n, bits, 32));
  }

  const ipv6 = parseIPv6(host.replace(/^\[|\]$/g, ""));
  if (ipv6 === null) {
    return false;
  }
  const embedded = embeddedIPv4(ipv6);
  if (embedded !== null) {
    return BLOCKED_IPV4.some(([base, bits]) => inRange(embedded, parseIPv4(base) ?? 0n, bits, 32));
  }
  return BLOCKED_IPV6.some(([base, bits]) => inRange(ipv6, parseIPv6(base) ?? 0n, bits, 128));
}

function inRange(address: bigint, base: bigint, prefixBits: number, totalBits: number): boolean {
  const shift = BigInt(totalBits - prefixBits);
  return address >> shift === base >> shift;
}

function parseIPv4(text: string): bigint | null {
  const parts = text.split(".");
  if (parts.length !== 4) return null;
  let value = 0n;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = (value << 8n) | BigInt(octet);
  }
  return value;
}

function parseIPv6(text: string): bigint | null {
  if (!text.includes(":")) return null;
  const halves = text.split("::");
  if (halves.length > 2) return null;

  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;

  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  let value = 0n;
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(group)) return null;
    value = (value << 16n) | BigInt(Number.parseInt(group, 16));
  }
  return value;
}

// ::ffff:a.b.c.d (IPv4-mapped) and 64:ff9b::a.b.c.d (NAT64) reach an IPv4 address
function embeddedIPv4(ipv6: bigint): bigint | null {
  const top96 = ipv6 >> 32n;
  if (top96 === 0xffffn || top96 === 0x64ff9b0000000000000000n) {
    return ipv6 & 0xffffffffn;
  }
  return null;
}
