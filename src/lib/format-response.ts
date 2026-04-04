import { NextResponse } from "next/server";

/**
 * Converts a JS object/value to a simple XML string.
 */
function toXml(obj: unknown, root = "response"): string {
  const escape = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  function serialize(value: unknown, tag: string): string {
    if (value === null || value === undefined) return `<${tag}/>`;
    if (Array.isArray(value)) {
      return value.map((item, i) => serialize(item, `item`)).join("");
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
 * Returns a formatted API response based on the `format` query parameter.
 * Supports: json (default), xml, jsonp, simple.
 */
export function formatResponse(
  data: Record<string, unknown>,
  format: string | null,
  status = 200,
  callback?: string | null,
  simpleField?: string
): NextResponse | Response {
  switch (format) {
    case "xml":
      return new NextResponse(toXml({ success: true, data, statusCode: status }), {
        status,
        headers: { "Content-Type": "application/xml; charset=utf-8" },
      });

    case "jsonp": {
      const cb = callback && /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(callback) ? callback : "callback";
      const body = `/**/${cb}(${JSON.stringify({ success: true, data, statusCode: status })});`;
      return new NextResponse(body, {
        status,
        headers: { "Content-Type": "application/javascript; charset=utf-8" },
      });
    }

    case "simple": {
      const text = simpleField ? String((data as Record<string, unknown>)[simpleField] ?? "") : "";
      return new NextResponse(text, {
        status,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    default:
      return NextResponse.json({ success: true, data, statusCode: status }, { status });
  }
}
