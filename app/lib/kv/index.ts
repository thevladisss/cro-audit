/**
 * The key-value layer: one object, whichever driver the env calls for.
 *
 * It knows nothing about runs. Key spelling, TTL policy and what a value means
 * live in `lib/runs` — this module's whole job is a `get` and a `set` that work
 * the same against Upstash and against a `Map`. The drivers themselves are not
 * exported: there is one way to reach the store, so there is one place a
 * backend swap lands.
 */
export { kv } from "./kv";
