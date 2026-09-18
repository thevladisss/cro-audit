/**
 * Whether this process is a serverless function rather than a machine.
 *
 * Vercel sets `VERCEL`; every Lambda sets `AWS_LAMBDA_FUNCTION_NAME`. Neither
 * exists on a laptop, which is the only distinction that matters here.
 *
 * One fact, read by callers who act on it differently: `lib/collector` launches
 * the bundled Chromium binary instead of a local one, and anything needing
 * credentials can treat their absence as fatal here and as normal in dev.
 */
export function isServerless(): boolean {
  return Boolean(
    process.env.VERCEL ?? process.env.AWS_LAMBDA_FUNCTION_NAME ?? undefined,
  );
}
