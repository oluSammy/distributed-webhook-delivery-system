import { describe, expect, it } from "vitest";
import { checkEndpointUrl, isBlockedAddress } from "../src/ssrf.ts";

const production = { allowLocal: false };
const local = { allowLocal: true };

describe("checkEndpointUrl in production", () => {
  it("accepts a public https URL", () => {
    expect(checkEndpointUrl("https://hooks.example.com/webhooks", production)).toBeNull();
  });

  it.each([
    ["http://hooks.example.com/", "must use https"],
    ["ftp://hooks.example.com/", "must use https"],
    ["https://user:pass@hooks.example.com/", "must not contain credentials"],
    ["not a url", "not a valid URL"],
  ])("rejects %s", (url, reason) => {
    expect(checkEndpointUrl(url, production)).toBe(reason);
  });

  it.each([
    "https://localhost/",
    "https://LOCALHOST./",
    "https://printer.local/",
    "https://db.internal/",
    "https://app.localhost/",
  ])("rejects the local host name %s", (url) => {
    expect(checkEndpointUrl(url, production)).toBe("must not point at a local host name");
  });

  it.each([
    "https://127.0.0.1/",
    "https://2130706433/",
    "https://0x7f.1/",
    "https://10.1.2.3/",
    "https://172.20.0.1/",
    "https://192.168.1.10/",
    "https://169.254.169.254/latest/meta-data/",
    "https://100.64.0.1/",
    "https://0.0.0.0/",
    "https://[::1]/",
    "https://[::ffff:127.0.0.1]/",
    "https://[::ffff:169.254.169.254]/",
    "https://[64:ff9b::10.0.0.1]/",
    "https://[fd00:ec2::254]/",
    "https://[fe80::1]/",
  ])("rejects the private address in %s", (url) => {
    expect(checkEndpointUrl(url, production)).toBe(
      "must not point at a private, loopback or reserved address",
    );
  });

  it.each(["https://8.8.8.8/", "https://[2606:4700:4700::1111]/", "https://172.32.0.1/"])(
    "accepts the public address in %s",
    (url) => {
      expect(checkEndpointUrl(url, production)).toBeNull();
    },
  );
});

describe("checkEndpointUrl in local development", () => {
  it("allows http://localhost for the test consumer", () => {
    expect(checkEndpointUrl("http://localhost:4000/ok", local)).toBeNull();
  });

  it("still rejects other schemes and credentials", () => {
    expect(checkEndpointUrl("ftp://localhost/", local)).toBe("must use https");
    expect(checkEndpointUrl("http://a:b@localhost/", local)).toBe("must not contain credentials");
  });
});

describe("isBlockedAddress", () => {
  it("is false for host names, which DNS must resolve first", () => {
    expect(isBlockedAddress("hooks.example.com")).toBe(false);
  });

  it("checks the range edges", () => {
    expect(isBlockedAddress("172.15.255.255")).toBe(false);
    expect(isBlockedAddress("172.16.0.0")).toBe(true);
    expect(isBlockedAddress("172.31.255.255")).toBe(true);
    expect(isBlockedAddress("172.32.0.0")).toBe(false);
  });
});
