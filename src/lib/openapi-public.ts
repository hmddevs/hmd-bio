export const openApiPublicSpec = {
  openapi: "3.0.3",
  info: {
    title: "HMD.bio Public API",
    version: "1.0.0",
    description:
      "Public URL shortening API by HMD Developments. Shorten links, expand them, and view global stats. For admin endpoints (link management, analytics, API keys), authenticate via the admin dashboard.",
    contact: {
      name: "HMD Developments",
      url: "https://hmddevs.org",
    },
  },
  servers: [{ url: "https://hmd.bio", description: "Production" }],
  tags: [
    {
      name: "Public",
      description: "No authentication required (rate-limited)",
    },
  ],
  paths: {
    "/api/v1/shorten": {
      post: {
        tags: ["Public"],
        summary: "Shorten a URL",
        description:
          "Create a short link. Either a valid Cloudflare Turnstile token **or** a Bearer API key is required when used programmatically.",
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
                    description: "The URL to shorten",
                  },
                  keyword: {
                    type: "string",
                    maxLength: 100,
                    pattern: "^[a-zA-Z0-9_-]+$",
                    description: "Custom keyword (optional)",
                  },
                  title: { type: "string", maxLength: 500 },
                  turnstileToken: {
                    type: "string",
                    description:
                      "Cloudflare Turnstile token (required unless using Bearer API key)",
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
                  },
                },
              },
            },
          },
          "400": { description: "Validation error" },
          "401": {
            description:
              "Unauthorized — missing Turnstile token and API key",
          },
          "409": { description: "Keyword already taken" },
          "429": { description: "Rate limited (30 req/min)" },
        },
      },
    },
    "/api/v1/expand": {
      get: {
        tags: ["Public"],
        summary: "Expand a short link",
        parameters: [
          {
            name: "keyword",
            in: "query",
            required: true,
            schema: { type: "string" },
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
                  },
                },
              },
            },
          },
          "404": { description: "Link not found" },
          "429": { description: "Rate limited (60 req/min)" },
        },
      },
    },
    "/api/v1/stats": {
      get: {
        tags: ["Public"],
        summary: "Get public stats",
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
                  },
                },
              },
            },
          },
          "429": { description: "Rate limited (60 req/min)" },
        },
      },
    },
  },
  components: {},
};
