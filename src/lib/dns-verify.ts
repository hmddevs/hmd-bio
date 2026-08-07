/**
 * DNS TXT ownership verification for custom domains.
 *
 * A user proves control of `example.com` by publishing the token we issued at
 * `_hmd-verify.example.com`. Nothing is sent to Vercel until this passes.
 */

import { Resolver } from "node:dns/promises";
import { timingSafeEqualStr } from "@/lib/utils";

const LOOKUP_TIMEOUT_MS = 5_000;

/** Subdomain label the verification record must live under. */
export const VERIFICATION_PREFIX = "_hmd-verify";

export interface DnsVerificationResult {
  /** At least one TXT record exists at the verification name. */
  found: boolean;
  /** One of those records equals the expected token. */
  matched: boolean;
  /** Every record found, flattened. Safe to show the user: it is their own DNS. */
  records: string[];
}

/** The fully-qualified name the user must create the TXT record at. */
export function verificationRecordName(hostname: string): string {
  return `${VERIFICATION_PREFIX}.${hostname}`;
}

/**
 * Resolvers are built per call with explicit public servers rather than
 * inheriting the platform's resolver configuration, so verification behaves
 * the same on a local machine and on Vercel.
 */
function createResolver(): Resolver {
  const resolver = new Resolver({ timeout: LOOKUP_TIMEOUT_MS, tries: 2 });
  resolver.setServers(["1.1.1.1", "8.8.8.8"]);
  return resolver;
}

/** DNS answers that mean "no such record", which is a clean negative. */
const CLEAN_NEGATIVES = new Set(["ENOTFOUND", "ENODATA", "NXDOMAIN", "ESERVFAIL", "EREFUSED"]);

function isCleanNegative(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return typeof code === "string" && CLEAN_NEGATIVES.has(code);
}

/**
 * Resolves TXT records for `_hmd-verify.<hostname>` and compares them against
 * the expected token.
 *
 * A missing record, an empty answer, or a resolver refusal is reported as
 * `{ found: false, matched: false }`, not thrown: "the user has not created
 * the record yet" is the normal case, not an error. Only an unexpected
 * resolver fault propagates.
 */
export async function verifyDomainTxt(
  hostname: string,
  expectedToken: string
): Promise<DnsVerificationResult> {
  const name = verificationRecordName(hostname);
  const resolver = createResolver();

  let chunked: string[][];
  try {
    // A single TXT record longer than 255 bytes arrives split into chunks;
    // joining them is required before comparison.
    chunked = await resolver.resolveTxt(name);
  } catch (error) {
    if (isCleanNegative(error)) {
      return { found: false, matched: false, records: [] };
    }
    // A timeout is also a negative rather than a fault: the caller retries.
    if ((error as NodeJS.ErrnoException | null)?.code === "ETIMEOUT") {
      return { found: false, matched: false, records: [] };
    }
    throw error;
  }

  const records = chunked.map((chunks) => chunks.join("").trim()).filter((r) => r.length > 0);

  // Compare every record, but never short-circuit on the first match, so the
  // work done does not depend on record ordering.
  let matched = false;
  for (const record of records) {
    if (timingSafeEqualStr(record, expectedToken)) matched = true;
  }

  return { found: records.length > 0, matched, records };
}
