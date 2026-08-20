import "server-only";

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
