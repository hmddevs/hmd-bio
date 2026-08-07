import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { Link } from "@/models/Link";
import { Domain } from "@/models/Domain";
import { bulkImportSchema } from "@/lib/validations";
import { apiSuccess, apiError } from "@/lib/api-response";
import { requireAuth } from "@/lib/api-auth";
import { rateLimitCaller } from "@/lib/rate-limit";
import { captureError } from "@/lib/errors";
import { generateKeyword, isReservedKeyword, isAllowedProtocol } from "@/lib/utils";
import { checkDomainWritable } from "@/lib/domain-access";
import { PRIMARY_DOMAIN, buildShortUrl } from "@/lib/domains";

export async function POST(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (!authResult.ok) return authResult.response;
  const { session } = authResult;

  const rl = await rateLimitCaller("links-bulk", session);
  if (!rl.allowed) {
    return apiError("Too many requests", 429);
  }

  try {
    const body = await request.json();
    const parsed = bulkImportSchema.safeParse(body);
    if (!parsed.success) {
      return apiError("Invalid import data: " + parsed.error.issues[0].message, 400);
    }

    await connectDB();

    const results: {
      keyword: string;
      domain: string;
      url: string;
      shortUrl?: string;
      status: "created" | "skipped";
      reason?: string;
    }[] = [];

    // One ownership check per distinct domain in the payload, not per row: a
    // 500-row import on one domain would otherwise make 500 identical queries.
    const domainAccess = new Map<string, boolean>();
    async function canWriteTo(domain: string): Promise<boolean> {
      const cached = domainAccess.get(domain);
      if (cached !== undefined) return cached;
      const check = await checkDomainWritable(domain, session.user.id, session.access);
      domainAccess.set(domain, check.ok);
      return check.ok;
    }

    for (const item of parsed.data) {
      const domain = item.domain;

      if (!(await canWriteTo(domain))) {
        results.push({
          keyword: item.keyword || "",
          domain,
          url: item.url,
          status: "skipped",
          reason: "You do not have an active domain with that hostname",
        });
        continue;
      }

      if (!isAllowedProtocol(item.url)) {
        results.push({ keyword: item.keyword || "", domain, url: item.url, status: "skipped", reason: "Protocol not allowed" });
        continue;
      }

      let keyword = item.keyword?.trim() || generateKeyword();
      // Reserved keywords apply to the primary domain only.
      if (domain === PRIMARY_DOMAIN && isReservedKeyword(keyword)) {
        results.push({ keyword, domain, url: item.url, status: "skipped", reason: "Reserved keyword" });
        continue;
      }

      const existing = await Link.findOne({ domain, keyword }).lean();
      if (existing) {
        if (item.keyword) {
          results.push({ keyword, domain, url: item.url, status: "skipped", reason: "Keyword taken" });
          continue;
        }
        keyword = generateKeyword();
      }

      try {
        await Link.create({
          domain,
          keyword,
          url: item.url,
          title: item.title || "",
          owner: session.user.id,
          clicks: 0,
          statusCode: 301,
          createdVia: "bulk",
        });
      } catch (err) {
        // The compound unique index is the authoritative guard; a duplicate
        // here means a concurrent write won. Skip the row rather than aborting
        // the whole import.
        if (typeof err === "object" && err !== null && (err as { code?: number }).code === 11000) {
          results.push({ keyword, domain, url: item.url, status: "skipped", reason: "Keyword taken" });
          continue;
        }
        throw err;
      }

      results.push({
        keyword,
        domain,
        url: item.url,
        shortUrl: buildShortUrl(domain, keyword),
        status: "created",
      });
    }

    // Best-effort per-domain link counters; never fails the import.
    const createdPerDomain = new Map<string, number>();
    for (const result of results) {
      if (result.status !== "created" || result.domain === PRIMARY_DOMAIN) continue;
      createdPerDomain.set(result.domain, (createdPerDomain.get(result.domain) ?? 0) + 1);
    }
    for (const [hostname, count] of createdPerDomain) {
      Domain.updateOne({ hostname }, { $inc: { linkCount: count } })
        .exec()
        .catch((err: unknown) => {
          captureError(err, { route: "api/v1/links/bulk", stage: "link-count" });
        });
    }

    const created = results.filter((r) => r.status === "created").length;
    const skipped = results.filter((r) => r.status === "skipped").length;

    return apiSuccess({ results, summary: { created, skipped, total: results.length } }, 201);
  } catch (err) {
    captureError(err, { route: "api/v1/links/bulk" });
    return apiError("Internal server error", 500);
  }
}
