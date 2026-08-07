import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { Link } from "@/models/Link";
import { shortenSchema } from "@/lib/validations";
import { apiSuccess, apiError } from "@/lib/api-response";
import { authenticateRequest, requireTurnstile } from "@/lib/auth";
import { hashIP, encryptIP } from "@/lib/ip";
import { rateLimit } from "@/lib/rate-limit";
import { captureError } from "@/lib/errors";
import { Domain } from "@/models/Domain";
import { checkDomainWritable } from "@/lib/domain-access";
import { PRIMARY_DOMAIN, buildShortUrl } from "@/lib/domains";
import {
  generateKeyword,
  isReservedKeyword,
  isAllowedProtocol,
  fetchPageTitle,
} from "@/lib/utils";

/** MongoDB's duplicate-key error code, raised by the (domain, keyword) index. */
const DUPLICATE_KEY = 11000;

function isDuplicateKeyError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: number }).code === DUPLICATE_KEY
  );
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = shortenSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(parsed.error.issues[0].message, 400);
    }

    const { url, keyword: customKeyword, title, domain, turnstileToken } = parsed.data;

    // Identity must be established before Turnstile is decided: an authenticated
    // caller (session or API key) is already accountable for their requests, so
    // only an anonymous caller needs the human-verification gate.
    const user = await authenticateRequest(request);

    // Cloudflare Turnstile verification: rejects a missing/invalid token
    // whenever TURNSTILE_SECRET_KEY is configured, skips only in dev mode.
    // Authenticated callers skip this entirely; anonymous callers are gated
    // strictly on user === null, never on a client-supplied header or field.
    if (!user) {
      const turnstileRejection = await requireTurnstile(turnstileToken, request);
      if (turnstileRejection) return turnstileRejection;
    }

    // Protocol check
    if (!isAllowedProtocol(url)) {
      return apiError("URL protocol not allowed", 400);
    }

    const rawIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "";
    const ipHash = hashIP(rawIp);

    // Anonymous callers share a per-IP bucket at the public rate. An
    // authenticated caller gets their own bucket at the authenticated rate,
    // matching every other /api/v1 route; keying them by IP would throttle a
    // whole office or NAT down to one user's allowance.
    const rl = user
      ? await rateLimit(`shorten:user:${user.id}`, { tier: "authenticated" })
      : await rateLimit(`shorten:${ipHash}`, { tier: "public" });
    if (!rl.allowed) {
      return apiError("Too many requests", 429);
    }

    await connectDB();

    // A non-primary domain must belong to the caller and be active. Anonymous
    // callers are refused outright, so the public shortener can only ever write
    // to the primary domain.
    const access = await checkDomainWritable(domain, user?.id ?? null);
    if (!access.ok) {
      return apiError(access.message, access.status);
    }
    const targetDomain = access.domain;

    // Generate or validate keyword
    let keyword = customKeyword?.trim() || generateKeyword();

    // Reserved keywords protect the platform's own routes, which only exist on
    // the primary domain. What a tenant does with go.example.com/admin is their
    // business.
    if (targetDomain === PRIMARY_DOMAIN && isReservedKeyword(keyword)) {
      return apiError("This keyword is reserved", 400);
    }

    // Availability is per-domain: the same keyword may exist once on each. This
    // pre-check is a convenience that gives a clean 409; the compound unique
    // index below is the guard that actually holds under concurrency.
    let existing = await Link.findOne({ domain: targetDomain, keyword }).lean();
    if (existing && customKeyword) {
      return apiError("Keyword already in use", 409);
    }
    while (existing) {
      keyword = generateKeyword();
      existing = await Link.findOne({ domain: targetDomain, keyword }).lean();
    }

    // Auto-fetch title if not provided
    const linkTitle = title || (await fetchPageTitle(url));

    const { iv: ipIv, ciphertext: ipRaw } = encryptIP(rawIp);

    let link;
    try {
      link = await Link.create({
        domain: targetDomain,
        keyword,
        url,
        title: linkTitle,
        ipRaw,
        ipIv,
        clicks: 0,
        statusCode: 301,
        owner: user?.id ?? null,
        createdVia: "api",
      });
    } catch (err) {
      // Two requests raced the pre-check and the unique (domain, keyword) index
      // rejected the loser. That is the authoritative answer, so report it as a
      // conflict rather than a 500.
      if (isDuplicateKeyError(err)) {
        return apiError("Keyword already in use", 409);
      }
      throw err;
    }

    // Best-effort counter for the dashboard. A failure here must never turn a
    // successfully created link into an error response.
    if (targetDomain !== PRIMARY_DOMAIN) {
      Domain.updateOne({ hostname: targetDomain }, { $inc: { linkCount: 1 } })
        .exec()
        .catch((err: unknown) => {
          captureError(err, { route: "api/v1/shorten", stage: "link-count" });
        });
    }

    return apiSuccess(
      {
        keyword: link.keyword,
        domain: link.domain,
        url: link.url,
        shortUrl: buildShortUrl(link.domain, link.keyword),
        title: link.title,
        createdAt: link.createdAt,
      },
      201
    );
  } catch (err) {
    captureError(err, { route: "api/v1/shorten" });
    return apiError("Internal server error", 500);
  }
}
