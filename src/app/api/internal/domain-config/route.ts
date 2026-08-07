import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { hashIP } from "@/lib/ip";
import { rateLimit } from "@/lib/rate-limit";
import { captureError } from "@/lib/errors";
import { timingSafeEqualStr } from "@/lib/utils";
import { PRIMARY_DOMAIN, isPlatformHost, normaliseHost } from "@/lib/domains";
import { getDomainConfig } from "@/lib/domain-config-cache";

/**
 * Internal deeplink-configuration endpoint called by the middleware.
 *
 * The proxy runs at the edge and cannot import Mongoose, so it asks for the
 * mode, the two association files, and the fallback target the same way it asks
 * for link data: over the internal API, guarded by INTERNAL_SECRET.
 *
 * Only called on the paths a deeplink domain adds, never on the hot redirect
 * path, so an ordinary short link pays nothing for this route existing.
 */
export async function GET(request: NextRequest) {
  // Same guard as internal/resolve: fail closed if the secret is not
  // configured, never skip the check.
  const internalSecret = process.env.INTERNAL_SECRET;
  if (!internalSecret) {
    return Response.json({ error: "Service unavailable" }, { status: 503 });
  }
  const provided = request.headers.get("x-internal-secret");
  if (!provided || !timingSafeEqualStr(provided, internalSecret)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const domain = normaliseHost(request.nextUrl.searchParams.get("domain") ?? "");
  // Neither the primary domain nor any other host the platform is served on
  // (localhost, a preview deployment) is a tenant, and none has configuration
  // to hand out. Answering 404 keeps the "never serve these on the primary
  // domain" rule true even if a future caller forgets it, and stops the
  // parameter being pointed back at the platform's own hostnames.
  //
  // Note on what does *not* guard this route: the `domain` parameter cannot be
  // bound to the request's own Host header. The caller is the edge proxy, which
  // must address this route on a platform-trusted origin rather than the
  // tenant's hostname (see internalOrigin in src/proxy.ts), so the Host here is
  // always the platform's and never the tenant whose config is wanted. Binding
  // to it would 404 every custom domain. INTERNAL_SECRET is the only guard,
  // which is precisely why that secret must never be sent to a tenant origin.
  if (!domain || domain === PRIMARY_DOMAIN || isPlatformHost(domain)) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const clientIP = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const rl = await rateLimit(`domain-config:${hashIP(clientIP)}`, { limit: 120, windowMs: 60_000 });
  if (!rl.allowed) {
    return Response.json({ error: "Too many requests" }, { status: 429 });
  }

  try {
    await connectDB();
    const config = await getDomainConfig(domain);
    if (!config) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }
    return Response.json(config);
  } catch (err) {
    // Answered as 503 rather than 404 so the two stay distinguishable in
    // Sentry and to any future caller: "the read broke" is not "no such
    // domain". The proxy currently degrades both to shortener behaviour
    // without retrying, so today the distinction is for diagnosis only.
    captureError(err, { route: "internal/domain-config", domain });
    return Response.json({ error: "Service unavailable" }, { status: 503 });
  }
}
