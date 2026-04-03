import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { Link } from "@/models/Link";
import { apiSuccess, apiError } from "@/lib/api-response";
import { authenticateRequest } from "@/lib/auth";
import QRCode from "qrcode";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ keyword: string }> }
) {
  const user = await authenticateRequest(request);
  if (!user) {
    return apiError("Unauthorized", 401);
  }

  try {
    const { keyword } = await params;
    await connectDB();

    const link = await Link.findOne({ keyword }).lean();
    if (!link) {
      return apiError("Link not found", 404);
    }

    const shortUrl = `${process.env.AUTH_URL || "https://hmd.bio"}/${keyword}`;
    const svg = await QRCode.toString(shortUrl, { type: "svg", margin: 2 });

    return apiSuccess({ keyword, shortUrl, svg });
  } catch (err) {
    console.error("QR code error:", err);
    return apiError("Internal server error", 500);
  }
}
