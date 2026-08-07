import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { Click } from "@/models/Click";
import { Link } from "@/models/Link";
import { apiSuccess, apiError } from "@/lib/api-response";
import { requireAuth } from "@/lib/api-auth";
import { rateLimitCaller } from "@/lib/rate-limit";
import { captureError } from "@/lib/errors";
import { decryptIP } from "@/lib/ip";
import { recordAudit } from "@/lib/audit";

/**
 * Composite map key for a (domain, keyword) pair.
 *
 * `JSON.stringify` rather than a delimiter string: a keyword may contain very
 * nearly any character, so any single separator risks two different pairs
 * producing one key. This previously used a literal NUL byte, which collided
 * with nothing but made git classify the whole file as binary, so every change
 * to it rendered as "Bin 3768 -> 5012 bytes" and passed through review unread.
 */
function linkKey(domain: string, keyword: string): string {
  return JSON.stringify([domain, keyword]);
}

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (!authResult.ok) return authResult.response;
  const { session } = authResult;
  if (session.user.role !== "admin") {
    return apiError("Forbidden — admin access required", 403);
  }

  const rl = await rateLimitCaller("admin-clicks", session);
  if (!rl.allowed) return apiError("Too many requests", 429);

  try {
    const url = request.nextUrl;
    const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") || "50", 10)));
    const keyword = url.searchParams.get("keyword")?.trim() || "";
    const country = url.searchParams.get("country")?.trim() || "";
    const browser = url.searchParams.get("browser")?.trim() || "";
    const os = url.searchParams.get("os")?.trim() || "";

    await connectDB();

    // NOTE: there is no plaintext "ip" field on Click any more (see
    // src/models/Click.ts — ipRaw/ipIv is AES-256-GCM ciphertext only), so
    // the old regex-based "ip" query filter has been dropped: it can't be
    // matched against encrypted data without decrypting every row first.
    const filter: Record<string, unknown> = {};
    if (keyword) filter.keyword = keyword;
    if (country) filter.countryCode = country.toUpperCase();
    if (browser) filter.browser = { $regex: browser.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
    if (os) filter.os = { $regex: os.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };

    const [clicks, total] = await Promise.all([
      Click.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Click.countDocuments(filter),
    ]);

    // Look up link titles by (domain, keyword) pair, never by keyword alone: a
    // keyword-only match attributes another tenant's title and destination to
    // this click, and no longer hits an index since uniqueness became compound.
    const pairs = [
      ...new Map(
        clicks.map((c) => [linkKey(c.domain, c.keyword), { domain: c.domain, keyword: c.keyword }])
      ).values(),
    ];
    const links = pairs.length
      ? await Link.find({ $or: pairs })
          .select("domain keyword title url")
          .lean()
      : [];
    const linkMap = new Map(
      links.map((l) => [linkKey(l.domain, l.keyword), { title: l.title, url: l.url }])
    );

    const rows = clicks.map((c) => ({
      id: c._id.toString(),
      keyword: c.keyword,
      domain: c.domain,
      linkTitle: linkMap.get(linkKey(c.domain, c.keyword))?.title || "",
      linkUrl: linkMap.get(linkKey(c.domain, c.keyword))?.url || "",
      createdAt: c.createdAt.toISOString(),
      // Admin-only decrypt of the AES-256-GCM ciphertext; never expose ipRaw/ipIv directly.
      ip: c.ipRaw && c.ipIv ? decryptIP(c.ipIv, c.ipRaw) : "",
      countryCode: c.countryCode || "",
      browser: c.browser || "",
      os: c.os || "",
      referrer: c.referrer || "",
      userAgent: c.userAgent || "",
    }));

    // Every response from this route hands an administrator visitors' plaintext
    // addresses, so every response leaves a record. Only the rows that actually
    // yielded an address are logged: a page of clicks with no ciphertext, or
    // ciphertext that failed to decrypt, exposed nothing. The clicks are
    // referenced by id, never by the value that was revealed, so the trail is
    // correlatable without the audit collection becoming a second place the
    // addresses live.
    //
    // This is the ONE caller that acts on the outcome. `recordAudit` fails open
    // by design, and that is right for the four write paths: they call it after
    // their change has already committed, so refusing the request there would
    // report failure for work that actually happened. Nothing has been
    // disclosed here yet. The addresses are still only in `rows`, in memory,
    // and the administrator sees them only when `apiSuccess` runs below, so the
    // choice is not "fail a completed action" but "lose the evidence" against
    // "make the administrator retry". This log exists to be evidence, so we
    // fail closed: no entry, no rows.
    const exposed = rows.filter((r) => r.ip !== "");
    if (exposed.length > 0) {
      const outcome = await recordAudit({
        request,
        actor: session.user,
        action: "admin.click_ip.decrypt",
        subjectType: "click",
        subjectIds: exposed.map((r) => r.id),
        subjectCount: exposed.length,
        route: "admin/clicks:GET",
        // The filter that selected them, so a reviewer can see the shape of the
        // search rather than only its results.
        detail: {
          page,
          limit,
          filterKeyword: keyword,
          filterCountry: country,
          filterBrowser: browser,
          filterOs: os,
          matchingTotal: total,
        },
      });

      if (outcome !== "written") {
        // `recordAudit` has already reported the underlying failure to Sentry
        // with the actor and subject count, so this adds the refusal itself and
        // nothing that would put an address in an error payload.
        captureError(new Error(`Audit entry not written (${outcome}); disclosure refused.`), {
          route: "admin/clicks:GET",
          stage: "audit-required",
          auditOutcome: outcome,
          subjectCount: exposed.length,
        });
        return apiError("Audit unavailable, refusing to disclose visitor addresses", 503);
      }
    }

    return apiSuccess({
      clicks: rows,
      total,
      page,
      pages: Math.ceil(total / limit),
    });
  } catch (err) {
    captureError(err, { route: "admin/clicks:GET" });
    return apiError("Internal server error", 500);
  }
}
