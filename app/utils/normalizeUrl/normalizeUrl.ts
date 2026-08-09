export type NormalizeUrlResult = { url: string } | { error: string };

/**
 * Validation here is deliberately thin — `lib/safety.ts` is the real guard, and
 * duplicating its rules in the browser would mean two places to keep in sync.
 * This only catches what would obviously waste a round trip.
 */
export function normalizeUrl(raw: string): NormalizeUrlResult {
  const trimmed = raw.trim();

  if (trimmed.length === 0) {
    return { error: "Enter a URL to audit." };
  }

  // Bare hostnames are what people actually type; `new URL` rejects them.
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return { error: "That doesn't look like a valid URL." };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { error: "Only http and https URLs are supported." };
  }

  if (parsed.hostname.length === 0 || !parsed.hostname.includes(".")) {
    return { error: "That doesn't look like a valid URL." };
  }

  return { url: parsed.toString() };
}
