import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { Link } from "@/models/Link";
import { apiError } from "@/lib/api-response";
import { requireAuth } from "@/lib/api-auth";
import { rateLimit } from "@/lib/rate-limit";
import { captureError } from "@/lib/errors";

// Neutralise leading characters that spreadsheet apps (Excel/Sheets) treat
// as formula triggers, to prevent formula-injection when a user opens the
// exported CSV (e.g. a link title of "=HYPERLINK(...)").
function csvField(value: string): string {
  const escaped = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${escaped.replace(/"/g, '""')}"`;
}

function csvRow(l: {
  keyword: string;
  url: string;
  title?: string;
  clicks: number;
  statusCode: number;
  createdAt: Date;
}): string {
  return `${csvField(l.keyword)},${csvField(l.url)},${csvField(l.title || "")},${l.clicks},${l.statusCode},${l.createdAt.toISOString()}\n`;
}

export async function GET(request: NextRequest) {
  const authResult = await requireAuth(request);
  if (!authResult.ok) return authResult.response;
  const { session } = authResult;

  const rl = await rateLimit(`links-export:${session.user.id}`, { tier: "authenticated" });
  if (!rl.allowed) {
    return apiError("Too many requests", 429);
  }

  try {
    await connectDB();

    const filter: Record<string, unknown> = {};
    if (session.user.role !== "admin") {
      filter.owner = session.user.id;
    }

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(encoder.encode("keyword,url,title,clicks,statusCode,createdAt\n"));

        const cursor = Link.find(filter).sort({ createdAt: -1 }).lean().cursor();
        try {
          for await (const link of cursor) {
            controller.enqueue(encoder.encode(csvRow(link)));
          }
        } catch (err) {
          captureError(err, { route: "api/v1/links/export", stage: "stream" });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="hmd-bio-links-${new Date().toISOString().split("T")[0]}.csv"`,
      },
    });
  } catch (err) {
    captureError(err, { route: "api/v1/links/export" });
    return apiError("Internal server error", 500);
  }
}
