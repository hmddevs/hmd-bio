/**
 * Public-facing subset of the API spec, for third-party developers
 * integrating against hmd.bio programmatically (Bearer API key or
 * anonymous + Turnstile).
 *
 * Every other `/api/v1/*` route (link management, click analytics, API key
 * management, password change) is gated by `requireAuth()`, which only
 * accepts a NextAuth dashboard session cookie — there is no API-key path
 * into those routes, so they are dashboard-internal and deliberately
 * excluded here. See src/lib/openapi.ts for the full spec.
 */
export const openApiPublicSpec = {
  openapi: "3.0.3",
  info: {
    title: "HMD.bio Public API",
    version: "1.0.0",
    description:
      "Public URL shortening API by HMD Developments. Shorten links, expand them back to their destination, and read global platform stats. These are the only three endpoints reachable with an API key or anonymously — link management, analytics, and account settings all require signing in to the dashboard and are not part of this public surface.",
    contact: {
      name: "HMD Developments",
      url: "https://hmddevs.org",
    },
  },
  servers: [{ url: "https://hmd.bio", description: "Production" }],
  tags: [
    {
      name: "Public",
      description: "No authentication required, rate-limited by IP",
    },
  ],
  paths: {
    "/api/v1/shorten": {
      post: {
        tags: ["Public"],
        summary: "Shorten a URL",
        description:
          "Creates a short link. A Cloudflare Turnstile token is required in `turnstileToken` (or an `X-Turnstile-Token` header) whenever the deployment has Turnstile configured — this applies to every caller, including requests sent with a Bearer API key, since the Turnstile check runs before authentication. Supplying a Bearer API key does not exempt a request from Turnstile; it only attributes the created link to that account instead of leaving it anonymous.",
        security: [{ BearerAuth: [] }, {}],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["url"],
                properties: {
                  url: {
                    type: "string",
                    format: "uri",
                    description: "The destination URL to shorten",
                  },
                  keyword: {
                    type: "string",
                    minLength: 2,
                    maxLength: 100,
                    pattern: "^[a-zA-Z0-9_-]*$",
                    description:
                      "Custom keyword. Omit to get a random 5-character keyword.",
                  },
                  title: {
                    type: "string",
                    maxLength: 500,
                    description:
                      "Optional title. When omitted, the destination page's <title> is fetched automatically.",
                  },
                  turnstileToken: {
                    type: "string",
                    description:
                      "Cloudflare Turnstile token, required unless the deployment has no TURNSTILE_SECRET_KEY configured (dev only)",
                  },
                },
              },
              examples: {
                default: {
                  value: {
                    url: "https://example.com/a-very-long-path",
                    keyword: "my-link",
                    turnstileToken: "0x4AAA...",
                  },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Link created",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean" },
                    data: {
                      type: "object",
                      properties: {
                        keyword: { type: "string" },
                        url: { type: "string" },
                        shortUrl: { type: "string" },
                        title: { type: "string" },
                        createdAt: { type: "string", format: "date-time" },
                      },
                    },
                    statusCode: { type: "integer" },
                  },
                },
                example: {
                  success: true,
                  data: {
                    keyword: "my-link",
                    url: "https://example.com/a-very-long-path",
                    shortUrl: "https://hmd.bio/my-link",
                    title: "Example Domain",
                    createdAt: "2026-07-02T09:15:00.000Z",
                  },
                  statusCode: 201,
                },
              },
            },
          },
          "400": {
            description:
              "Validation error (invalid URL, invalid keyword format, or disallowed protocol)",
          },
          "403": {
            description: "Missing or invalid Turnstile token",
          },
          "409": { description: "Keyword already taken" },
          "429": { description: "Rate limited (public tier: 30 req/min per IP)" },
        },
      },
    },
    "/api/v1/expand": {
      get: {
        tags: ["Public"],
        summary: "Expand a short link",
        description:
          "Looks up a keyword and returns its destination without following the redirect. Does not increment the click counter.",
        parameters: [
          {
            name: "keyword",
            in: "query",
            required: true,
            schema: { type: "string" },
            description: "The short link's keyword (the part after hmd.bio/)",
          },
        ],
        responses: {
          "200": {
            description: "Expanded link info",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean" },
                    data: {
                      type: "object",
                      properties: {
                        keyword: { type: "string" },
                        url: { type: "string" },
                        title: { type: "string" },
                        createdAt: { type: "string", format: "date-time" },
                      },
                    },
                    statusCode: { type: "integer" },
                  },
                },
                example: {
                  success: true,
                  data: {
                    keyword: "my-link",
                    url: "https://example.com/a-very-long-path",
                    title: "Example Domain",
                    createdAt: "2026-07-02T09:15:00.000Z",
                  },
                  statusCode: 200,
                },
              },
            },
          },
          "400": { description: "Missing `keyword` query parameter" },
          "404": { description: "Short link not found" },
          "429": { description: "Rate limited (public tier: 30 req/min per IP)" },
        },
      },
    },
    "/api/v1/stats": {
      get: {
        tags: ["Public"],
        summary: "Get global platform stats",
        description: "Aggregate, non-identifying totals across every link on the platform.",
        responses: {
          "200": {
            description: "Global statistics",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean" },
                    data: {
                      type: "object",
                      properties: {
                        totalLinks: { type: "integer" },
                        totalClicks: { type: "integer" },
                      },
                    },
                    statusCode: { type: "integer" },
                  },
                },
                example: {
                  success: true,
                  data: { totalLinks: 48213, totalClicks: 1928447 },
                  statusCode: 200,
                },
              },
            },
          },
          "429": { description: "Rate limited (public tier: 30 req/min per IP)" },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      BearerAuth: {
        type: "http",
        scheme: "bearer",
        description:
          "API key starting with hmd_. Only recognised by /api/v1/shorten, where it attributes the created link to your account; it does not exempt the request from Turnstile.",
      },
    },
  },
};
