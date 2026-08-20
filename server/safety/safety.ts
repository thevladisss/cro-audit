import "server-only";

import { lookup } from "node:dns/promises";

import { ALLOWED_PORTS, MAX_REDIRECTS } from "./safety.constants.ts";
import { isPrivateAddress } from "./safety.utils.ts";

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

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

/** Throws unless `raw` is a public http(s) URL on a standard port. */
export async function throwIfInvalidURL(raw: string): Promise<void> {
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
  let target = raw;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await throwIfInvalidURL(target);

    const response = await fetch(target, { ...init, redirect: "manual" });

    if (response.status < 300 || response.status > 399) return response;

    const location = response.headers.get("location");
    if (!location) return response;

    // Resolved against the hop we just fetched, so a relative `Location` lands
    // where the browser would put it — and goes through the guard next pass.
    target = new URL(location, target).toString();
  }

  throw new UnsafeUrlError("Too many redirects.");
}
