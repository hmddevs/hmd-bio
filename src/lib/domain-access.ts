/**
 * Write-side authorisation for custom domains.
 *
 * The read side (may this hostname serve a redirect?) lives in
 * `@/lib/domain-cache`. This module answers the different question of whether a
 * given caller may create links on a given domain, which needs the owner and so
 * is never served from the hostname-keyed cache.
 *
 * Link creation is not a hot path, so this always reads MongoDB.
 */

import type { NextRequest } from "next/server";
import { Domain } from "@/models/Domain";
import { PRIMARY_DOMAIN, domainFromHost, normaliseHost } from "@/lib/domains";
import { domainQuerySchema } from "@/lib/validations";
import {
  accessPermitsDomain,
  domainScopeFilter,
  type CallerAccess,
} from "@/lib/api-key-scope";

/**
 * Reads `?domain=` from a request that addresses one specific link.
 *
 * An absent parameter resolves to the primary domain. That is deliberate, and
 * deliberately different from the list endpoint (`/api/v1/links`), where an
 * absent parameter means "every domain the caller owns": a single-record route
 * must resolve to exactly one domain, and defaulting to primary is what keeps
 * every pre-custom-domain client working unchanged.
 *
 * Returns null when the supplied value is not a valid hostname, which the
 * caller should turn into a 400.
 */
export function domainFromQuery(request: NextRequest): string | null {
  const raw = request.nextUrl.searchParams.get("domain");
  if (raw === null) return PRIMARY_DOMAIN;

  const parsed = domainQuerySchema.safeParse({ domain: raw });
  if (!parsed.success) return null;

  return parsed.data.domain ?? PRIMARY_DOMAIN;
}

/**
 * Like `domainFromQuery`, but falls back to the request's own Host header
 * instead of the primary domain when `?domain=` is absent.
 *
 * For routes fetched same-origin by a page that may itself be served on a
 * custom domain (the stats preview reached via "keyword+"). On the primary
 * domain the fallback is the primary domain, so behaviour is unchanged for
 * every existing caller.
 */
export function domainFromQueryOrHost(request: NextRequest): string | null {
  const raw = request.nextUrl.searchParams.get("domain");
  if (raw === null) {
    return domainFromHost(
      request.headers.get("x-forwarded-host") ?? request.headers.get("host")
    );
  }

  const parsed = domainQuerySchema.safeParse({ domain: raw });
  if (!parsed.success) return null;

  return parsed.data.domain ?? PRIMARY_DOMAIN;
}

/**
 * A Mongoose filter matching one hostname owned by this caller, narrowed by
 * any per-key domain restriction.
 *
 * The domain routes address a Domain document by hostname and enforce
 * ownership through the query itself (`{ hostname, owner }`), so that an
 * unowned hostname is a 404 rather than a 403 and the endpoint never confirms
 * a hostname is claimed. Folding the key's restriction into the same filter
 * keeps that property: a domain the key may not touch is indistinguishable
 * from one that does not exist.
 *
 * Every route that loads a single Domain must build its filter here rather
 * than inlining `{ hostname, owner }`, so the restriction cannot be omitted at
 * one of them.
 */
export function ownedDomainFilter(
  hostname: string,
  userId: string,
  access: CallerAccess
): Record<string, unknown> {
  return {
    hostname,
    owner: userId,
    ...domainScopeFilter(access, "hostname"),
  };
}

export type DomainWriteCheck =
  | { ok: true; domain: string }
  | { ok: false; status: 400 | 403; message: string };

/**
 * Decides whether `userId` may create or edit links on `hostname`.
 *
 * The primary domain is open to everyone, including anonymous callers, which
 * keeps the public shortener working exactly as before. Any other domain
 * requires an authenticated caller who owns a Domain record for that hostname
 * with status `active`; a domain that is still verifying, has failed, or has
 * been suspended is refused.
 *
 * Ownership and status are checked in the same query, so a caller can never
 * learn whether someone else's domain exists: both cases return the same 403.
 *
 * `access` is the credential's own restriction, and is checked before
 * ownership. This is the create-side counterpart to `requireOwnership`: there
 * is no document to inspect yet, so the domain the caller asked for is checked
 * directly. Passing `undefined` means an anonymous caller, who has no key and
 * so no restriction, and is already confined to the primary domain below.
 */
export async function checkDomainWritable(
  hostname: string,
  userId: string | null | undefined,
  access?: CallerAccess
): Promise<DomainWriteCheck> {
  const domain = normaliseHost(hostname);
  if (!domain) {
    return { ok: false, status: 400, message: "Invalid domain" };
  }

  // Applies to the primary domain too: a key confined to a custom domain must
  // not be able to create links on hmd.bio either, so this sits above the
  // primary-domain shortcut.
  if (access && !accessPermitsDomain(access, domain)) {
    return {
      ok: false,
      status: 403,
      message: "This API key is not permitted on that domain",
    };
  }

  if (domain === PRIMARY_DOMAIN) {
    return { ok: true, domain };
  }

  if (!userId) {
    return {
      ok: false,
      status: 403,
      message: "Authentication is required to create links on a custom domain",
    };
  }

  const owned = await Domain.exists({
    hostname: domain,
    owner: userId,
    status: "active",
  });

  if (!owned) {
    return {
      ok: false,
      status: 403,
      message: "You do not have an active domain with that hostname",
    };
  }

  return { ok: true, domain };
}
