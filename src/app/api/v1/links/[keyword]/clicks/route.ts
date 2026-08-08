import { NextRequest } from "next/server";
import { z } from "zod";
import { connectDB } from "@/lib/db";
import { Click } from "@/models/Click";
import { Link } from "@/models/Link";
import { apiSuccess, apiError } from "@/lib/api-response";
import { requireAuth, requireOwnership } from "@/lib/api-auth";
import { rateLimitCaller } from "@/lib/rate-limit";
import { captureError } from "@/lib/errors";
import { domainFromQuery } from "@/lib/domain-access";
import { recordAudit, isAdministrativeAccess } from "@/lib/audit";
import { anonymiseClicks, deleteClicks } from "@/lib/click-retention";

/**
 * Ceiling on the batches one erasure request may run.
 *
 * The audit entry is written after the erasure, so an unbounded run that
 * outlives the invocation would leave rows destroyed and nothing recording it,
 * which is the exact gap the entry exists to close. At `DEFAULT_BATCH_SIZE` per
 * batch this covers 10,000 clicks in one call, more than any single link on the
 * platform holds today; anything larger re-issues, and the response says so.
 */
const MAX_ERASURE_BATCHES = 20;

const clicksQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/**
 * Erasure is deliberately awkward to ask for.
 *
 * `mode` has no default, so neither outcome can happen because a field was
 * omitted, and `confirm` has to echo the exact `domain/keyword` being erased,
 * which a caller cannot produce by accident or by replaying a request against a
 * different link. This is the same shape as a "type the repository name to
 * delete it" confirmation, and it is here for the same reason: `delete` takes
 * the analytics with it and there is nothing to restore from.
 *
 * What it is not: an authorisation control. Both halves come from the URL the
 * caller is already calling, so anything able to issue the request can compute
 * the value. It defends against a mistake, not against an attacker, and the
 * things that actually stop a hostile call are the ownership check, the scope
 * check and the audit entry. Cross-origin abuse is separately blocked because a
 * JSON `DELETE` needs a preflight and no `Access-Control-Allow-Origin` is set
 * anywhere, with the session cookie `SameSite=Lax` behind that.
 */
const eraseClicksSchema = z.object({
  mode: z.enum(["anonymise", "delete"], {
    message: "mode must be \"anonymise\" (keeps the analytics row) or \"delete\" (removes it)",
  }),
  confirm: z.string(),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ keyword: string }> }
) {
  const authResult = await requireAuth(request);
  if (!authResult.ok) return authResult.response;
  const { session } = authResult;

  const rl = await rateLimitCaller("clicks-list", session);
  if (!rl.allowed) {
    return apiError("Too many requests", 429);
  }

  try {
    const { keyword } = await params;
    const searchParams = Object.fromEntries(request.nextUrl.searchParams);
    const parsed = clicksQuerySchema.safeParse(searchParams);
    if (!parsed.success) {
      return apiError(parsed.error.issues[0].message, 400);
    }
    const { page, limit } = parsed.data;

    const domain = domainFromQuery(request);
    if (!domain) return apiError("Invalid domain", 400);

    await connectDB();

    const link = await Link.findOne({ domain, keyword }).lean();
    if (!link) {
      return apiError("Link not found", 404);
    }

    const forbidden = requireOwnership(link, session, { notFoundMessage: "Link not found" });
    if (forbidden) return forbidden;

    const [clicks, total] = await Promise.all([
      Click.find({ domain, keyword })
        // The encrypted visitor address and its IV never leave this server by
        // this route. Decryption is an admin-only path with its own audit, and
        // the sibling link routes all carry the same projection.
        .select("-ipRaw -ipIv")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Click.countDocuments({ domain, keyword }),
    ]);

    return apiSuccess({
      clicks,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    captureError(err, { route: "v1/links/[keyword]/clicks" });
    return apiError("Internal server error", 500);
  }
}

/**
 * Erase the click log for one of the caller's own links.
 *
 * The self-service half of retention, so nobody has to contact support to have
 * their visitors' data removed. Two modes, and the caller must name one:
 *
 * - `anonymise` clears the personal fields (encrypted address, IV, user agent)
 *   and keeps the anonymous row, so the link's analytics survive. This is the
 *   one to reach for, and the one the scheduled retention script runs.
 * - `delete` removes the rows outright. Irreversible, and it takes the
 *   analytics with it.
 *
 * It lives here, on the link's own click collection, rather than as a new
 * top-level route, because this is already the endpoint that reads exactly the
 * rows it erases: it inherits `requireOwnership` (including the domain
 * restriction on a scoped key, and its 404-not-403 posture) unchanged, rather
 * than restating an ownership test somewhere new. A caller can therefore only
 * ever erase clicks on a link they own, on a domain their credential covers.
 *
 * A read-only API key cannot reach this at all: scope is derived from the HTTP
 * method in `authenticateRequest`, and DELETE requires write.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ keyword: string }> }
) {
  const authResult = await requireAuth(request);
  if (!authResult.ok) return authResult.response;
  const { session } = authResult;

  // Its own bucket, and a much smaller one. A separate bucket alone would have
  // been worse than none: it would have handed the caller a second full
  // authenticated allowance, so a stolen write-scoped key could erase a hundred
  // links a minute on top of its ordinary traffic. Erasure is deliberate and
  // occasional, so five a minute is generous for a person and slow for a script.
  const rl = await rateLimitCaller("clicks-erase", session, { limit: 5, windowMs: 60_000 });
  if (!rl.allowed) {
    return apiError("Too many requests", 429);
  }

  try {
    const { keyword } = await params;
    const domain = domainFromQuery(request);
    if (!domain) return apiError("Invalid domain", 400);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      // Narrow and deliberate: an unparseable body on a destructive endpoint is
      // the caller's error, not ours, and it must not read as "no confirmation
      // needed". Nothing else in this handler is caught here.
      return apiError("A JSON body with \"mode\" and \"confirm\" is required", 400);
    }

    const parsed = eraseClicksSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(parsed.error.issues[0].message, 400);
    }

    const expectedConfirmation = `${domain}/${keyword}`;
    if (parsed.data.confirm !== expectedConfirmation) {
      return apiError(
        `To confirm, set "confirm" to "${expectedConfirmation}". This erases click data and ` +
          `cannot be undone.`,
        400
      );
    }

    await connectDB();

    const link = await Link.findOne({ domain, keyword }).lean();
    if (!link) {
      return apiError("Link not found", 404);
    }

    const forbidden = requireOwnership(link, session, { notFoundMessage: "Link not found" });
    if (forbidden) return forbidden;

    const ownerId = link.owner ? link.owner.toString() : null;
    const scope = { domain, keyword };

    let anonymised = 0;
    let deleted = 0;
    let incomplete = false;

    if (parsed.data.mode === "anonymise") {
      // Everything strictly older than the moment the request was accepted,
      // which is every click on the link at that point. A visit arriving while
      // the batches run is a visit made after the erasure was requested, so it
      // is deliberately out of scope rather than silently swept up; the
      // documented behaviour matches.
      const result = await anonymiseClicks({
        before: new Date(),
        scope,
        maxBatches: MAX_ERASURE_BATCHES,
      });
      anonymised = result.anonymised;
      incomplete = result.stoppedAtLimit;
    } else {
      const result = await deleteClicks({ scope, maxBatches: MAX_ERASURE_BATCHES });
      deleted = result.deleted;
      incomplete = result.stoppedAtLimit;
    }

    // Every erasure through this route is recorded, self-service included.
    // An erasure is irreversible whoever performs it, and this collection's
    // remit is administrative access AND destructive actions, not the first
    // alone: without an entry here, a stolen write-scoped key could work
    // through an account link by link and leave nothing behind. It also cuts
    // the other way and protects us, which is the DPA purpose the log exists
    // for: if a customer later disputes what became of their data, an entry
    // saying they themselves asked for the erasure, when, and over how many
    // rows, is the answer.
    //
    // `requireOwnership` lets an administrator through on somebody else's link,
    // so the same handler serves both cases and the two must stay tellable
    // apart. Which action is used is decided by the shared predicate rather
    // than by a restated ownership test here, which is exactly how the admin
    // edit path once ended up unaudited. Nothing recorded below is personal: a
    // domain, a keyword, an owner id and a count. The ciphertext, IV and user
    // agent are never read by this route.
    const administrative = isAdministrativeAccess(session.user, ownerId);
    const auditActions = administrative
      ? ({ anonymise: "admin.click.anonymise", delete: "admin.click.delete" } as const)
      : ({ anonymise: "link.click.anonymise", delete: "link.click.delete" } as const);

    // The outcome is deliberately ignored: the erasure above has already
    // committed, so failing the request here would report failure for work that
    // actually happened. `admin/clicks:GET` is the sole route that fails closed
    // instead, because nothing has been disclosed at its call site yet.
    await recordAudit({
      request,
      actor: session.user,
      action: auditActions[parsed.data.mode],
      subjectType: "click",
      subjectIds: [`${domain} ${keyword}`],
      subjectCount: anonymised + deleted,
      route: "links/[keyword]/clicks:DELETE",
      detail: {
        domain,
        keyword,
        owner: ownerId,
        mode: parsed.data.mode,
        anonymised,
        deleted,
        selfService: !administrative,
      },
    });

    // `incomplete` says the batch ceiling stopped the run with rows still
    // matching, so the caller should re-issue the same request rather than
    // assume the link is clear. Reported rather than hidden: silently returning
    // a partial erasure as a complete one is how a customer comes to believe
    // data is gone when it is not, which on this endpoint is the worst thing it
    // could do.
    return apiSuccess({
      domain,
      keyword,
      mode: parsed.data.mode,
      anonymised,
      deleted,
      incomplete,
    });
  } catch (err) {
    captureError(err, { route: "v1/links/[keyword]/clicks", method: "DELETE" });
    return apiError("Internal server error", 500);
  }
}
