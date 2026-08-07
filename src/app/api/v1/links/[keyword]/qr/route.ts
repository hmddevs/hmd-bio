import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { Link } from "@/models/Link";
import { apiSuccess, apiError } from "@/lib/api-response";
import { requireAuth, requireOwnership } from "@/lib/api-auth";
import { hashIP } from "@/lib/ip";
import { rateLimit } from "@/lib/rate-limit";
import { captureError } from "@/lib/errors";
import { domainFromQuery } from "@/lib/domain-access";
import { buildShortUrl } from "@/lib/domains";
import QRCode from "qrcode";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ keyword: string }> }
) {
  const authResult = await requireAuth(request);
  if (!authResult.ok) return authResult.response;
  const { session } = authResult;

  const rawIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "";
  const ipHash = hashIP(rawIp);
  const rl = await rateLimit(`qr:${ipHash}`, { tier: "public" });
  if (!rl.allowed) {
    return apiError("Too many requests", 429);
  }

  const { keyword } = await params;
  const domain = domainFromQuery(request);
  if (!domain) return apiError("Invalid domain", 400);

  try {
    await connectDB();

    const link = await Link.findOne({ domain, keyword }).lean();
    if (!link) {
      return apiError("Link not found", 404);
    }

    const forbidden = requireOwnership(link, session, { notFoundMessage: "Link not found" });
    if (forbidden) return forbidden;

    // The QR code must encode the link's own domain, not the platform's.
    const shortUrl = buildShortUrl(link.domain, link.keyword);
    const svg = await QRCode.toString(shortUrl, { type: "svg", margin: 2 });

    return apiSuccess({ keyword, domain: link.domain, shortUrl, svg });
  } catch (err) {
    captureError(err, { route: "links/[keyword]/qr", keyword });
    return apiError("Internal server error", 500);
  }
}
