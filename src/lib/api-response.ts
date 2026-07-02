import { NextRequest, NextResponse } from "next/server";

interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  statusCode: number;
}

/**
 * Converts a JS value to a simple XML string, mirroring the shape of the JSON body.
 */
function toXml(obj: unknown, root = "response"): string {
  const escape = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  function serialize(value: unknown, tag: string): string {
    if (value === null || value === undefined) return `<${tag}/>`;
    if (Array.isArray(value)) {
      return value.map((item) => serialize(item, "item")).join("");
    }
    if (typeof value === "object" && value instanceof Date) {
      return `<${tag}>${escape(value.toISOString())}</${tag}>`;
    }
    if (typeof value === "object") {
      const inner = Object.entries(value as Record<string, unknown>)
        .map(([k, v]) => serialize(v, k))
        .join("");
      return `<${tag}>${inner}</${tag}>`;
    }
    return `<${tag}>${escape(String(value))}</${tag}>`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>\n${serialize(obj, root)}`;
}

/**
 * Formats an API response body per the `?format=` query param on the request
 * (json | xml | jsonp | text). Falls back to plain JSON when no request, or an
 * unrecognised/absent format, is supplied - preserving existing behaviour.
 */
function formatBody<T>(body: ApiResponse<T>, statusCode: number, request?: NextRequest) {
  const format = request?.nextUrl.searchParams.get("format");

  switch (format) {
    case "xml":
      return new NextResponse(toXml(body), {
        status: statusCode,
        headers: {
          "Content-Type": "application/xml; charset=utf-8",
          "X-Content-Type-Options": "nosniff",
        },
      });

    case "jsonp": {
      const callbackParam = request?.nextUrl.searchParams.get("callback");
      const callback =
        callbackParam && /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(callbackParam)
          ? callbackParam
          : "callback";
      const responseBody = `/**/${callback}(${JSON.stringify(body)});`;
      return new NextResponse(responseBody, {
        status: statusCode,
        headers: {
          "Content-Type": "application/javascript; charset=utf-8",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    case "text": {
      const text = body.success ? String(body.data ?? "") : String(body.error ?? "");
      return new NextResponse(text, {
        status: statusCode,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    default:
      return NextResponse.json(body, { status: statusCode });
  }
}

export function apiSuccess<T>(data: T, statusCode = 200, request?: NextRequest) {
  const body: ApiResponse<T> = { success: true, data, statusCode };
  return formatBody(body, statusCode, request);
}

export function apiError(error: string, statusCode = 400, request?: NextRequest) {
  const body: ApiResponse = { success: false, error, statusCode };
  return formatBody(body, statusCode, request);
}
