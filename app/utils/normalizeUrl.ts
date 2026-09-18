/**
 * The canonical spelling of a URL someone typed, or `null` if it is not one.
 *
 * It never throws. `new URL` throws on everything from an empty string to a
 * missing scheme, and a caller that has to wrap a parser in `try`/`catch` is a
 * caller that will eventually forget to — so the failure is a return value.
 *
 * Validation is deliberately thin: the SSRF guard on the route is the real one,
 * and duplicating its rules in the browser would mean two places to keep in
 * sync. This only catches what would obviously waste a round trip. Which
 * message a rejection deserves is the caller's business — a form knows its own
 * field is empty, and the store has no one to show a message to.
 */
export function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim();

  if (trimmed.length === 0) {
    return null;
  }

  // Bare hostnames are what people actually type; `new URL` rejects them.
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  let parsed: URL;

  try {
    parsed = new URL(withScheme);
  } catch {
    return null;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }

  // No dot means `localhost`, an intranet name, or a typo — none of which is a
  // page on the public web that the collector could render.
  if (!parsed.hostname.includes(".")) {
    return null;
  }

  return parsed.toString();
}
