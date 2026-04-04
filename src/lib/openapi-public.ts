export const openApiPublicSpec = {
  openapi: "3.0.3",
  info: {
    title: "HMD.bio API",
    version: "1.0.0",
    description: `URL shortening API by HMD Developments.

**Two API tiers:**

| Tier | Authentication | Rate Limit | Description |
|------|---------------|------------|-------------|
| **Public** | Turnstile token | 30 req/min | Shorten, expand, stats — no account needed |
| **User** | API key + Turnstile token | 100 req/min | Manage your own links, clicks & analytics |

**Turnstile tokens** are obtained client-side via the [Cloudflare Turnstile widget](https://developers.cloudflare.com/turnstile/). Pass them as \`turnstileToken\` in the request body or as the \`X-Turnstile-Token\` header for GET requests.

**API keys** start with \`hmd_\` and are managed from the dashboard or via the API keys endpoints below.`,
    contact: {
      name: "HMD Developments",
      url: "https://hmddevs.org",
    },
  },
  servers: [{ url: "https://hmd.bio", description: "Production" }],
  tags: [
    {
      name: "Public",
      description:
        "No account required. Only a Cloudflare Turnstile token is needed in production (30 req/min).",
    },
    {
      name: "Auth",
      description: "Registration and email verification",
    },
    {
      name: "User — Links",
      description:
        "Manage your own links. Requires Bearer API key **and** Turnstile token (100 req/min).",
    },
    {
      name: "User — Analytics",
      description:
        "View your own click logs and statistics. Requires Bearer API key **and** Turnstile token.",
    },
    {
      name: "User — API Keys",
      description:
        "Create, list, and delete your API keys. Requires Bearer API key **and** Turnstile token.",
    },
  ],
  paths: {
    // ── Public ──────────────────────────────────────────────
    "/api/v1/shorten": {
      post: {
        tags: ["Public"],
        summary: "Shorten a URL",
        description:
          "Create a short link. A Cloudflare Turnstile token is required. If you also provide a Bearer API key, the link is assigned to your account and you get higher rate limits (100 req/min).",
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
                      "Cloudflare Turnstile token (required in production)",
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
          "403": { description: "Turnstile verification failed" },
          "409": { description: "Keyword already taken" },
          "429": { description: "Rate limited" },
        },
      },
    },
    "/api/v1/expand": {
      get: {
        tags: ["Links"],
        summary: "Expand a short link",
        security: [{ ApiKeyAuth: [] }],
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
          "401": { description: "Unauthorized — API key required" },
          "404": { description: "Link not found" },
          "429": { description: "Rate limited (60 req/min)" },
        },
      },
    },
    "/api/v1/stats": {
      get: {
        tags: ["Stats"],
        summary: "Get global stats",
        security: [{ ApiKeyAuth: [] }],
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
          "401": { description: "Unauthorized — API key required" },
          "429": { description: "Rate limited (60 req/min)" },
        },
      },
    },

    // ── Auth ────────────────────────────────────────────────
    "/api/v1/auth/signup": {
      post: {
        tags: ["Auth"],
        summary: "Sign up for a new account",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email", "username", "password"],
                properties: {
                  email: { type: "string", format: "email" },
                  username: { type: "string", minLength: 3, maxLength: 30 },
                  password: { type: "string", minLength: 8 },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Account created — verification email sent" },
          "400": { description: "Validation error" },
          "409": { description: "Email or username already taken" },
          "429": { description: "Rate limited (5 req/min)" },
        },
      },
    },
    "/api/v1/auth/verify": {
      get: {
        tags: ["Auth"],
        summary: "Verify email address",
        parameters: [
          {
            name: "token",
            in: "query",
            required: true,
            schema: { type: "string" },
            description: "Verification token from email",
          },
        ],
        responses: {
          "302": { description: "Redirects to login on success" },
          "400": { description: "Invalid or expired token" },
        },
      },
    },

    // ── User — Links ───────────────────────────────────────
    "/api/v1/user/links": {
      get: {
        tags: ["User — Links"],
        summary: "List your links",
        description:
          "Returns paginated links owned by the authenticated user. Supports search, sort, and ordering.",
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: "X-Turnstile-Token",
            in: "header",
            required: true,
            schema: { type: "string" },
            description: "Cloudflare Turnstile token",
          },
          {
            name: "page",
            in: "query",
            schema: { type: "integer", default: 1 },
          },
          {
            name: "limit",
            in: "query",
            schema: { type: "integer", default: 15, maximum: 100 },
          },
          {
            name: "search",
            in: "query",
            schema: { type: "string" },
            description: "Search keywords, URLs, or titles",
          },
          {
            name: "sort",
            in: "query",
            schema: {
              type: "string",
              enum: ["keyword", "url", "clicks", "createdAt"],
              default: "createdAt",
            },
          },
          {
            name: "order",
            in: "query",
            schema: { type: "string", enum: ["asc", "desc"], default: "desc" },
          },
        ],
        responses: {
          "200": {
            description: "Paginated list of links",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean" },
                    data: {
                      type: "object",
                      properties: {
                        links: {
                          type: "array",
                          items: { $ref: "#/components/schemas/Link" },
                        },
                        pagination: {
                          $ref: "#/components/schemas/Pagination",
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          "401": { description: "Unauthorized — missing or invalid API key" },
          "403": { description: "Turnstile verification failed" },
        },
      },
    },
    "/api/v1/user/links/{keyword}": {
      delete: {
        tags: ["User — Links"],
        summary: "Delete one of your links",
        description:
          "Deletes a link you own and all associated click logs. Returns 403 if the link belongs to another user.",
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: "keyword",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
          {
            name: "X-Turnstile-Token",
            in: "header",
            required: true,
            schema: { type: "string" },
            description: "Cloudflare Turnstile token",
          },
        ],
        responses: {
          "200": {
            description: "Link deleted",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean" },
                    data: {
                      type: "object",
                      properties: {
                        deleted: { type: "string" },
                      },
                    },
                  },
                },
              },
            },
          },
          "401": { description: "Unauthorized" },
          "403": { description: "Forbidden — not your link, or Turnstile failed" },
          "404": { description: "Link not found" },
        },
      },
    },

    // ── User — Analytics ───────────────────────────────────
    "/api/v1/user/stats": {
      get: {
        tags: ["User — Analytics"],
        summary: "Get your link statistics",
        description:
          "Detailed analytics for all your links: totals, 24h clicks, weekly trend, top links, and top countries.",
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: "X-Turnstile-Token",
            in: "header",
            required: true,
            schema: { type: "string" },
            description: "Cloudflare Turnstile token",
          },
        ],
        responses: {
          "200": {
            description: "User statistics",
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
                        avgClicks: { type: "number" },
                        clicks24h: { type: "integer" },
                        weeklyTrend: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              _id: {
                                type: "string",
                                description: "Date (YYYY-MM-DD)",
                              },
                              count: { type: "integer" },
                            },
                          },
                        },
                        topLinks: {
                          type: "array",
                          items: { $ref: "#/components/schemas/Link" },
                        },
                        topCountries: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              _id: {
                                type: "string",
                                description: "ISO country code",
                              },
                              count: { type: "integer" },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          "401": { description: "Unauthorized" },
          "403": { description: "Turnstile verification failed" },
        },
      },
    },
    "/api/v1/user/clicks": {
      get: {
        tags: ["User — Analytics"],
        summary: "List click logs for your links",
        description:
          "Paginated click log across all your links, with optional filters by keyword, country, browser, and OS.",
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: "X-Turnstile-Token",
            in: "header",
            required: true,
            schema: { type: "string" },
            description: "Cloudflare Turnstile token",
          },
          {
            name: "page",
            in: "query",
            schema: { type: "integer", default: 1 },
          },
          {
            name: "limit",
            in: "query",
            schema: { type: "integer", default: 50, maximum: 100 },
          },
          {
            name: "keyword",
            in: "query",
            schema: { type: "string" },
            description: "Filter by a specific link keyword (must be yours)",
          },
          {
            name: "country",
            in: "query",
            schema: { type: "string" },
            description: "Filter by ISO country code (e.g. US, TR)",
          },
          {
            name: "browser",
            in: "query",
            schema: { type: "string" },
            description: "Filter by browser name (case-insensitive)",
          },
          {
            name: "os",
            in: "query",
            schema: { type: "string" },
            description: "Filter by OS name (case-insensitive)",
          },
        ],
        responses: {
          "200": {
            description: "Paginated click log",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean" },
                    data: {
                      type: "object",
                      properties: {
                        clicks: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              id: { type: "string" },
                              keyword: { type: "string" },
                              linkTitle: { type: "string" },
                              linkUrl: { type: "string" },
                              createdAt: {
                                type: "string",
                                format: "date-time",
                              },
                              countryCode: { type: "string" },
                              browser: { type: "string" },
                              os: { type: "string" },
                              referrer: { type: "string" },
                            },
                          },
                        },
                        total: { type: "integer" },
                        page: { type: "integer" },
                        pages: { type: "integer" },
                      },
                    },
                  },
                },
              },
            },
          },
          "401": { description: "Unauthorized" },
          "403": { description: "Forbidden — keyword not yours, or Turnstile failed" },
          "429": { description: "Rate limited (60 req/min)" },
        },
      },
    },

    // ── User — API Keys ────────────────────────────────────
    "/api/v1/user/api-keys": {
      get: {
        tags: ["User — API Keys"],
        summary: "List your API keys",
        description: "Returns your API keys with the key partially masked.",
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: "X-Turnstile-Token",
            in: "header",
            required: true,
            schema: { type: "string" },
            description: "Cloudflare Turnstile token",
          },
        ],
        responses: {
          "200": {
            description: "List of API keys",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean" },
                    data: {
                      type: "object",
                      properties: {
                        keys: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              _id: { type: "string" },
                              label: { type: "string" },
                              key: {
                                type: "string",
                                description: "Partially masked key",
                              },
                              createdAt: {
                                type: "string",
                                format: "date-time",
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          "401": { description: "Unauthorized" },
          "403": { description: "Turnstile verification failed" },
        },
      },
      post: {
        tags: ["User — API Keys"],
        summary: "Create an API key",
        description:
          "Generate a new `hmd_*` API key. The full key is returned **only once**. Maximum 5 keys per account.",
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: "X-Turnstile-Token",
            in: "header",
            required: true,
            schema: { type: "string" },
            description: "Cloudflare Turnstile token",
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  label: {
                    type: "string",
                    maxLength: 100,
                    default: "Default",
                  },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "API key created",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean" },
                    data: {
                      type: "object",
                      properties: {
                        key: {
                          type: "string",
                          description: "Full API key (shown only once)",
                        },
                        label: { type: "string" },
                      },
                    },
                  },
                },
              },
            },
          },
          "400": { description: "Maximum 5 API keys reached" },
          "401": { description: "Unauthorized" },
          "403": { description: "Turnstile verification failed" },
        },
      },
      delete: {
        tags: ["User — API Keys"],
        summary: "Delete an API key",
        security: [{ BearerAuth: [] }],
        parameters: [
          {
            name: "X-Turnstile-Token",
            in: "header",
            required: true,
            schema: { type: "string" },
            description: "Cloudflare Turnstile token",
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["id"],
                properties: {
                  id: { type: "string", description: "API key _id to delete" },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "API key deleted" },
          "401": { description: "Unauthorized" },
          "403": { description: "Turnstile verification failed" },
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
          "API key starting with `hmd_`. Obtain one from the dashboard or via POST /api/v1/user/api-keys.",
      },
    },
    schemas: {
      Link: {
        type: "object",
        properties: {
          _id: { type: "string" },
          keyword: { type: "string" },
          url: { type: "string" },
          title: { type: "string" },
          clicks: { type: "integer" },
          statusCode: { type: "integer", enum: [301, 302] },
          isPasswordProtected: { type: "boolean" },
          createdVia: {
            type: "string",
            enum: ["form", "api", "bulk", "dashboard"],
          },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
      Pagination: {
        type: "object",
        properties: {
          page: { type: "integer" },
          limit: { type: "integer" },
          total: { type: "integer" },
          totalPages: { type: "integer" },
        },
      },
    },
  },
};
