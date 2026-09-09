export enum CollectorErrorReason {
  /** The host does not resolve. */
  Dns = "dns",
  /** Navigation, or the whole collection, ran out of its budget. */
  Timeout = "timeout",
  /** Refused, reset, or aborted — including a site that turned us away. */
  Blocked = "blocked",
  /** Chromium itself would not start. Ours, not theirs. */
  Browser = "browser",
  /**
   * The caller went away. Not a failure of the page or of the network — the
   * work was cancelled while it was still going fine, which is why it is a
   * reason of its own rather than a `timeout` with a different message.
   */
  Aborted = "aborted",
}

export class CollectorError extends Error {
  readonly reason: CollectorErrorReason;

  constructor(reason: CollectorErrorReason, message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "CollectorError";
    this.reason = reason;
  }
}


/**
 * Chromium reports why a navigation failed in the `net::ERR_*` code it puts in
 * the message, and that string is the only structured thing Playwright passes
 * through. Matching on it is unlovely but stable — the codes are Chromium's
 * public error surface, not Playwright's prose.
 */
const NET_ERRORS: [RegExp, CollectorErrorReason][] = [
  [/ERR_NAME_NOT_RESOLVED|ERR_NAME_RESOLUTION_FAILED|getaddrinfo/i, CollectorErrorReason.Dns],
  [/ERR_TIMED_OUT|ERR_CONNECTION_TIMED_OUT|Timeout .* exceeded/i, CollectorErrorReason.Timeout],
];

/**
 * Anything not recognised becomes `blocked`. That is the honest default: we
 * reached the network, something refused, and guessing at a more specific cause
 * would put a wrong explanation in front of the user.
 */
export function toCollectorError(error: unknown, message: string): CollectorError {
  if (error instanceof CollectorError) return error;

  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);

  for (const [pattern, reason] of NET_ERRORS) {
    if (pattern.test(text)) return new CollectorError(reason, message, error);
  }

  if (error instanceof Error && error.name === "TimeoutError") {
    return new CollectorError(CollectorErrorReason.Timeout, message, error);
  }

  return new CollectorError(CollectorErrorReason.Blocked, message, error);
}
