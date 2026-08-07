/**
 * The single module permitted to mutate `Domain.status`.
 *
 * Every status change goes through `transition()`, which refuses anything the
 * map below does not allow. Routes must never assign `domain.status` directly:
 * an illegal transition is a bug, and it fails loudly rather than leaving a
 * domain in a state the rest of the system does not expect.
 *
 * Deletion is not a status. A route deletes the document outright.
 */

import { randomBytes } from "node:crypto";
import type { IDomain, DomainStatus } from "@/models/Domain";
import { Link } from "@/models/Link";
import { captureError } from "@/lib/errors";

/**
 * Legal status transitions.
 *
 *   pending_dns  -> verifying                  (user asks us to check DNS)
 *   verifying    -> provisioning | failed      (TXT matched, or it did not)
 *   provisioning -> active | failed            (Vercel issued the cert, or gave up)
 *   failed       -> verifying                  (user fixes DNS and retries)
 *   active       -> suspended | failed         (admin action, or the recheck
 *                                               cron finding the ownership TXT
 *                                               record gone)
 *   suspended    -> active                     (admin action)
 *
 * `active -> failed` is the revocation path. Without it the recheck cron could
 * never withdraw a domain whose DNS ownership record has disappeared, which is
 * exactly the case where the hostname may have been re-registered by somebody
 * else.
 */
export const DOMAIN_TRANSITIONS: Readonly<Record<DomainStatus, readonly DomainStatus[]>> = {
  pending_dns: ["verifying"],
  verifying: ["provisioning", "failed"],
  provisioning: ["active", "failed"],
  active: ["suspended", "failed"],
  failed: ["verifying"],
  suspended: ["active"],
};

export class IllegalDomainTransitionError extends Error {
  readonly from: DomainStatus;
  readonly to: DomainStatus;

  constructor(from: DomainStatus, to: DomainStatus) {
    super(`Illegal domain status transition: ${from} -> ${to}`);
    this.name = "IllegalDomainTransitionError";
    this.from = from;
    this.to = to;
  }
}

export function canTransition(from: DomainStatus, to: DomainStatus): boolean {
  return DOMAIN_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Fields a transition may set alongside the status change. */
export interface DomainTransitionPatch {
  verifiedAt?: Date | null;
  lastCheckedAt?: Date | null;
  failureReason?: string | null;
  vercelDomainId?: string | null;
}

/**
 * Moves a domain to `next`, applying `patch` in the same save, and persists it.
 *
 * Re-entering the current status is a no-op success, so a caller that retries
 * (for example, verifying an already-active domain) does not have to guard the
 * call site. Anything else illegal throws.
 */
export async function transition(
  domain: IDomain,
  next: DomainStatus,
  patch: DomainTransitionPatch = {}
): Promise<IDomain> {
  const current = domain.status;

  if (current !== next && !canTransition(current, next)) {
    const error = new IllegalDomainTransitionError(current, next);
    captureError(error, {
      module: "domain-state",
      hostname: domain.hostname,
      from: current,
      to: next,
    });
    throw error;
  }

  domain.status = next;
  if (patch.verifiedAt !== undefined) domain.verifiedAt = patch.verifiedAt;
  if (patch.lastCheckedAt !== undefined) domain.lastCheckedAt = patch.lastCheckedAt;
  if (patch.failureReason !== undefined) domain.failureReason = patch.failureReason;
  if (patch.vercelDomainId !== undefined) domain.vercelDomainId = patch.vercelDomainId;

  await domain.save();
  return domain;
}

/**
 * Stamps every link on a hostname as detached, and returns how many were
 * stamped.
 *
 * Call this wherever a hostname stops belonging to its current owner: an owner
 * deleting their domain, an admin deleting their account, or a stale unverified
 * claim being taken over. The links are kept rather than deleted so the data
 * stays recoverable, but `LIVE_LINK_FILTER` excludes a stamped row from every
 * resolution and public read path, so the next owner of the hostname can never
 * inherit them.
 *
 * Already-stamped rows keep their original timestamp: the filter only checks
 * for null, and the first detachment is the meaningful date.
 */
export async function detachLinksForHostname(hostname: string): Promise<number> {
  const result = await Link.updateMany(
    { domain: hostname, domainDetachedAt: null },
    { $set: { domainDetachedAt: new Date() } }
  );
  return result.modifiedCount;
}

/**
 * 32 bytes of CSPRNG output, base64url-encoded, for the TXT record value.
 * Base64url keeps it short enough for any registrar's TXT field while staying
 * free of characters that need quoting in a zone file.
 */
export function generateVerificationToken(): string {
  return `hmd-verify-${randomBytes(32).toString("base64url")}`;
}
