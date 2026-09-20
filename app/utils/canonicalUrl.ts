import { normalizeUrl } from "./normalizeUrl";

/**
 * One spelling per site, so `example.com` and `https://example.com/` are the
 * same string to anything that keys off a URL.
 *
 * The total counterpart of `normalizeUrl`: a URL that one rejects is not one
 * `collect` would accept either, so the raw string is kept rather than
 * invented — a caller that needs a key always gets one, and the rejection is
 * still the validator's to report.
 */
export function canonicalUrl(raw: string): string {
  return normalizeUrl(raw) ?? raw.trim();
}
