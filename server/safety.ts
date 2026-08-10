import "server-only";

import { lookup } from "node:dns/promises";

/**
 * SSRF guard — AUDIT-DESIGN §7.
 *
 * The audited URL is attacker-controlled by definition: anyone can type
 * anything into the form. Stage 2 is worse, because those URLs are chosen by a
 * model reading pages we do not control (CONCERNS.md §6). Both go through here.
 *
 * The load-bearing detail is that validation happens against the **resolved
 * address**, not the hostname. A hostname allowlist is not a control — an
 * attacker owns their own DNS and can point a perfectly ordinary name at
 * 169.254.169.254, which on a cloud host serves instance credentials.
 */

const MAX_REDIRECTS = 5;

/** A non-standard port is a strong signal something internal is being probed. */
const ALLOWED_PORTS = new Set(["", "80", "443"]);

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

/** Throws unless `raw` is a public http(s) URL on a standard port. */
export async function assertSafeUrl(raw: string): Promise<URL> {
  let url: URL;

  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeUrlError("That is not a valid URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeUrlError("Only http and https are supported.");
  }

  if (!ALLOWED_PORTS.has(url.port)) {
    throw new UnsafeUrlError("Only standard ports are supported.");
  }

  // `URL` keeps the brackets on an IPv6 literal; `lookup` will not take them.
  const hostname = url.hostname.replace(/^\[|\]$/g, "");

  if (hostname.length === 0) {
    throw new UnsafeUrlError("That is not a valid URL.");
  }

  let addresses: { address: string }[];

  try {
    // `all` matters: a name with one public and one private answer is a
    // rebinding attempt, and checking only the first would wave it through.
    addresses = await lookup(hostname, { all: true });
  } catch {
    throw new UnsafeUrlError("That host could not be resolved.");
  }

  if (addresses.length === 0 || addresses.some((a) => isPrivateAddress(a.address))) {
    throw new UnsafeUrlError("That host is not reachable.");
  }

  return url;
}

/**
 * `fetch` with the guard applied to every hop.
 *
 * `redirect: "manual"` is the entire point. The platform's automatic following
 * would validate the first URL and then happily chase a 302 to the metadata
 * service, which is the exact shape of the bug this module exists to prevent.
 */
export async function safeFetch(
  raw: string,
  init: RequestInit = {},
): Promise<Response> {
  let target = await assertSafeUrl(raw);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const response = await fetch(target, { ...init, redirect: "manual" });

    if (response.status < 300 || response.status > 399) return response;

    const location = response.headers.get("location");
    if (!location) return response;

    target = await assertSafeUrl(new URL(location, target).toString());
  }

  throw new UnsafeUrlError("Too many redirects.");
}

/**
 * Exported for the corpus test — it is the whole security decision, and testing
 * it directly beats testing it through a DNS round trip.
 */
export function isPrivateAddress(address: string): boolean {
  if (address.includes(":")) return isPrivateIpv6(address);
  return isPrivateIpv4(address);
}

function isPrivateIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);

  if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    // Unparseable is not provably public, so it does not get the benefit of the doubt.
    return true;
  }

  const [a, b] = octets as [number, number, number, number];

  return (
    a === 0 || // "this network"
    a === 10 || // RFC1918
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local — cloud instance metadata
    (a === 172 && b >= 16 && b <= 31) || // RFC1918
    (a === 192 && b === 168) || // RFC1918
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224 // multicast and reserved
  );
}

function isPrivateIpv6(address: string): boolean {
  const normalized = address.toLowerCase().split("%")[0] ?? "";

  // An IPv4-mapped address (::ffff:169.254.169.254) reaches the same host as
  // the bare v4 address, so it has to be unwrapped rather than pattern-matched.
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
  if (mapped?.[1]) return isPrivateIpv4(mapped[1]);

  // ...and `new URL()` rewrites that dotted form into hex (`::ffff:a9fe:a9fe`),
  // so the guard has to recognise both spellings of the same address.
  const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(normalized);
  if (mappedHex?.[1] && mappedHex[2]) {
    const high = Number.parseInt(mappedHex[1], 16);
    const low = Number.parseInt(mappedHex[2], 16);
    return isPrivateIpv4(
      `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`,
    );
  }

  return (
    normalized === "::" || // unspecified
    normalized === "::1" || // loopback
    /^f[cd]/.test(normalized) || // unique local, fc00::/7
    /^fe[89ab]/.test(normalized) // link-local, fe80::/10
  );
}
