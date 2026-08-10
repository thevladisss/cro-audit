// @vitest-environment node
//
// Opting out of jsdom keeps this fast and lets `node:dns` behave normally.
//
// The corpus is split deliberately: `isPrivateAddress` carries the entire
// security decision and is tested exhaustively as a pure function, while
// `assertSafeUrl` is tested on IP literals and scheme/port rejections, which
// `dns.lookup` short-circuits without touching a resolver. Nothing here needs
// a network, so nothing here is flaky.

import { describe, expect, it } from "vitest";

import { assertSafeUrl, isPrivateAddress, UnsafeUrlError } from "./safety.ts";

describe("isPrivateAddress", () => {
  it.each([
    ["0.0.0.0", "this-network"],
    ["10.0.0.1", "RFC1918 /8"],
    ["127.0.0.1", "loopback"],
    ["100.64.0.1", "CGNAT"],
    ["169.254.169.254", "cloud instance metadata"],
    ["172.16.0.1", "RFC1918 /12 lower bound"],
    ["172.31.255.255", "RFC1918 /12 upper bound"],
    ["192.168.1.1", "RFC1918 /16"],
    ["198.18.0.1", "benchmarking"],
    ["224.0.0.1", "multicast"],
    ["255.255.255.255", "broadcast"],
    ["::1", "IPv6 loopback"],
    ["::", "IPv6 unspecified"],
    ["fc00::1", "IPv6 unique local"],
    ["fd12:3456::1", "IPv6 unique local"],
    ["fe80::1", "IPv6 link-local"],
    ["fe80::1%en0", "IPv6 link-local with zone"],
    ["::ffff:127.0.0.1", "IPv4-mapped loopback"],
    ["::ffff:169.254.169.254", "IPv4-mapped metadata"],
    // `new URL()` rewrites the two above into hex, so both spellings are pinned.
    ["::ffff:7f00:1", "IPv4-mapped loopback, hex form"],
    ["::ffff:a9fe:a9fe", "IPv4-mapped metadata, hex form"],
    ["::ffff:c0a8:1", "IPv4-mapped RFC1918, hex form"],
    ["not-an-address", "unparseable"],
    ["1.2.3", "truncated"],
    ["1.2.3.999", "out of range"],
  ])("rejects %s (%s)", (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each([
    ["1.1.1.1"],
    ["8.8.8.8"],
    ["93.184.216.34"],
    ["172.15.255.255"], // just below the RFC1918 /12
    ["172.32.0.1"], // just above it
    ["100.63.255.255"], // just below CGNAT
    ["100.128.0.1"], // just above it
    ["223.255.255.255"], // just below multicast
    ["198.17.255.255"], // just below benchmarking
    ["2606:4700:4700::1111"], // public IPv6
    ["::ffff:8.8.8.8"], // IPv4-mapped public
    ["::ffff:808:808"], // the same, hex form
  ])("allows %s", (address) => {
    expect(isPrivateAddress(address)).toBe(false);
  });
});

describe("assertSafeUrl", () => {
  it.each([
    ["file:///etc/passwd", "non-http scheme"],
    ["gopher://example.com/", "non-http scheme"],
    ["data:text/html,<script>", "data URI"],
    ["javascript:alert(1)", "javascript URI"],
    ["not a url at all", "unparseable"],
    ["http://example.com:8080/", "non-standard port"],
    ["http://example.com:22/", "ssh port"],
    ["http://127.0.0.1/", "loopback literal"],
    ["http://127.0.0.1:80/", "loopback literal on port 80"],
    ["http://169.254.169.254/latest/meta-data/", "metadata literal"],
    ["http://10.0.0.1/", "RFC1918 literal"],
    ["http://192.168.1.1/", "RFC1918 literal"],
    ["http://[::1]/", "IPv6 loopback literal"],
    ["http://[::ffff:169.254.169.254]/", "IPv4-mapped metadata literal"],
    ["http://0.0.0.0/", "this-network literal"],
  ])("rejects %s (%s)", async (raw) => {
    await expect(assertSafeUrl(raw)).rejects.toThrow(UnsafeUrlError);
  });

  it.each([
    ["http://1.1.1.1/"],
    ["https://8.8.8.8/"],
    ["https://1.1.1.1:443/path?q=1"],
  ])("allows %s", async (raw) => {
    await expect(assertSafeUrl(raw)).resolves.toBeInstanceOf(URL);
  });

  it("returns the parsed URL so callers need not re-parse", async () => {
    const url = await assertSafeUrl("https://1.1.1.1/a/b?c=d");

    expect(url.hostname).toBe("1.1.1.1");
    expect(url.pathname).toBe("/a/b");
    expect(url.search).toBe("?c=d");
  });

  it("rejects a percent-encoded traversal without treating it as a scheme bypass", async () => {
    // %2e%2e stays in the path — it cannot climb out of the origin, and the
    // origin is what the guard is protecting. Included so the corpus records
    // that this was considered rather than missed.
    await expect(assertSafeUrl("http://127.0.0.1/%2e%2e/%2e%2e/etc/passwd")).rejects.toThrow(
      UnsafeUrlError,
    );
  });
});
