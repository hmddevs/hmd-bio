/**
 * OpenAPI 3 spec for the hmd.bio public REST API, served at /api/docs.
 *
 * Kept in sync by hand against the route handlers under src/app/api/v1/**.
 * Only documents endpoints that are actually implemented — see the bottom
 * of this file for a list of paths intentionally NOT included because they
 * don't exist in the codebase.
 */
export const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "HMD.bio API",
    version: "1.0.0",
    description:
      "REST API for HMD.bio, a URL shortener and link analytics platform. " +
      "Public endpoints (shorten, expand, stats) are rate-limited by IP and need no " +
      "authentication, aside from Cloudflare Turnstile on shorten. All other endpoints " +
      "manage a signed-in user's own links and require a dashboard session cookie.",
    contact: {
      name: "HMD Developments",
      url: "https://hmddevs.org",
    },
  },
  servers: [{ url: "https://hmd.bio", description: "Production" }],
  tags: [
    { name: "Public", description: "No authentication required (IP rate-limited)" },
    { name: "Links", description: "Link management — requires a dashboard session" },
    { name: "Stats", description: "Analytics — requires a dashboard session" },
    { name: "Account", description: "API keys, password & email — requires a dashboard session" },
    { name: "Auth", description: "Signup and email verification — no session required" },
    { name: "Admin", description: "Admin-only user and click management — requires a dashboard session with the admin role" },
  ],
  paths: {
    "/api/v1/shorten": {
      post: {
        tags: ["Public"],
        summary: "Create a short link",
        description:
          "Creates a short link. A valid Cloudflare Turnstile token is required unless " +
          "TURNSTILE_SECRET_KEY is unset (dev only). If the caller has a session cookie " +
          "or a valid `Bearer hmd_...` API key, the link is attributed to that user as its owner; " +
          "otherwise it is created anonymously.",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ShortenRequest" },
              example: { url: "https://example.com/some/long/path", keyword: "my-link" },
            },
          },
        },
        responses: {
          "201": {
            description: "Link created",
            content: {
              "application/json": {
                schema: {
                  allOf: [
                    { $ref: "#/components/schemas/ApiSuccessEnvelope" },
                    {
                      type: "object",
                      properties: { data: { $ref: "#/components/schemas/ShortenResult" } },
                    },
                  ],
                },
                example: {
                  success: true,
                  statusCode: 201,
                  data: {
                    keyword: "my-link",
                    url: "https://example.com/some/long/path",
                    shortUrl: "https://hmd.bio/my-link",
                    title: "Example Domain",
                    createdAt: "2026-07-02T10:00:00.000Z",
                  },
                },
              },
            },
          },
          "400": {
            description: "Validation error, or disallowed URL protocol",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiErrorEnvelope" },
                example: { success: false, statusCode: 400, error: "Invalid URL" },
              },
            },
          },
          "403": {
            description: "Turnstile token missing or invalid",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiErrorEnvelope" },
                example: { success: false, statusCode: 403, error: "Turnstile verification failed" },
              },
            },
          },
          "409": {
            description: "The requested custom keyword is already in use",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiErrorEnvelope" },
                example: { success: false, statusCode: 409, error: "Keyword already in use" },
              },
            },
          },
          "429": { $ref: "#/components/responses/RateLimited" },
          "500": { $ref: "#/components/responses/InternalError" },
        },
      },
    },
    "/api/v1/expand": {
      get: {
        tags: ["Public"],
        summary: "Resolve a short link without redirecting",
        security: [],
        parameters: [
          {
            name: "keyword",
            in: "query",
            required: true,
            schema: { type: "string" },
            description: "The short link's keyword",
          },
        ],
        responses: {
          "200": {
            description: "Link details",
            content: {
              "application/json": {
                schema: {
                  allOf: [
                    { $ref: "#/components/schemas/ApiSuccessEnvelope" },
                    {
                      type: "object",
                      properties: {
                        data: {
                          type: "object",
                          properties: {
                            keyword: { type: "string" },
                            url: { type: "string", format: "uri" },
                            title: { type: "string" },
                            createdAt: { type: "string", format: "date-time" },
                          },
                        },
                      },
                    },
                  ],
                },
              },
            },
          },
          "400": {
            description: "Missing keyword parameter",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiErrorEnvelope" },
                example: { success: false, statusCode: 400, error: "Missing keyword parameter" },
              },
            },
          },
          "404": {
            description: "No link with that keyword",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiErrorEnvelope" },
                example: { success: false, statusCode: 404, error: "Short URL not found" },
              },
            },
          },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
    },
    "/api/v1/stats": {
      get: {
        tags: ["Public"],
        summary: "Get platform-wide statistics",
        security: [],
        responses: {
          "200": {
            description: "Global totals",
            content: {
              "application/json": {
                schema: {
                  allOf: [
                    { $ref: "#/components/schemas/ApiSuccessEnvelope" },
                    {
                      type: "object",
                      properties: {
                        data: {
                          type: "object",
                          properties: {
                            totalLinks: { type: "integer" },
                            totalClicks: { type: "integer" },
                          },
                        },
                      },
                    },
                  ],
                },
                example: { success: true, statusCode: 200, data: { totalLinks: 48213, totalClicks: 1928374 } },
              },
            },
          },
          "429": { $ref: "#/components/responses/RateLimited" },
          "500": { $ref: "#/components/responses/InternalError" },
        },
      },
    },
    "/api/v1/links": {
      get: {
        tags: ["Links"],
        summary: "List links",
        description:
          "Returns links owned by the caller. Admins are not scoped to their own links and see every link on the platform.",
        security: [{ session: [] }, { BearerAuth: [] }],
        parameters: [
          { name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 15 } },
          { name: "search", in: "query", schema: { type: "string", maxLength: 200 }, description: "Case-insensitive substring match against keyword, url, and title" },
          { name: "sort", in: "query", schema: { type: "string", enum: ["keyword", "url", "clicks", "createdAt"], default: "createdAt" } },
          { name: "order", in: "query", schema: { type: "string", enum: ["asc", "desc"], default: "desc" } },
          { name: "dateFrom", in: "query", schema: { type: "string", format: "date-time" } },
          { name: "dateTo", in: "query", schema: { type: "string", format: "date-time" } },
          { name: "minClicks", in: "query", schema: { type: "integer", minimum: 0 } },
          { name: "maxClicks", in: "query", schema: { type: "integer", minimum: 0 } },
        ],
        responses: {
          "200": {
            description: "Paginated link list",
            content: {
              "application/json": {
                schema: {
                  allOf: [
                    { $ref: "#/components/schemas/ApiSuccessEnvelope" },
                    {
                      type: "object",
                      properties: {
                        data: {
                          type: "object",
                          properties: {
                            links: { type: "array", items: { $ref: "#/components/schemas/Link" } },
                            pagination: { $ref: "#/components/schemas/Pagination" },
                          },
                        },
                      },
                    },
                  ],
                },
              },
            },
          },
          "400": { $ref: "#/components/responses/ValidationError" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "429": { $ref: "#/components/responses/RateLimited" },
          "500": { $ref: "#/components/responses/InternalError" },
        },
      },
    },
    "/api/v1/links/{keyword}": {
      get: {
        tags: ["Links"],
        summary: "Get a link",
        security: [{ session: [] }, { BearerAuth: [] }],
        parameters: [{ $ref: "#/components/parameters/KeywordPath" }],
        responses: {
          "200": {
            description: "Link details, including the encrypted-at-rest password hash omitted",
            content: {
              "application/json": {
                schema: {
                  allOf: [
                    { $ref: "#/components/schemas/ApiSuccessEnvelope" },
                    { type: "object", properties: { data: { $ref: "#/components/schemas/Link" } } },
                  ],
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
      put: {
        tags: ["Links"],
        summary: "Update a link",
        security: [{ session: [] }, { BearerAuth: [] }],
        parameters: [{ $ref: "#/components/parameters/KeywordPath" }],
        requestBody: {
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/EditLinkRequest" },
            },
          },
        },
        responses: {
          "200": {
            description: "Updated link",
            content: {
              "application/json": {
                schema: {
                  allOf: [
                    { $ref: "#/components/schemas/ApiSuccessEnvelope" },
                    { type: "object", properties: { data: { $ref: "#/components/schemas/Link" } } },
                  ],
                },
              },
            },
          },
          "400": { $ref: "#/components/responses/ValidationError" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
          "409": {
            description: "New keyword already in use",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiErrorEnvelope" },
                example: { success: false, statusCode: 409, error: "New keyword already in use" },
              },
            },
          },
          "429": { $ref: "#/components/responses/RateLimited" },
          "500": { $ref: "#/components/responses/InternalError" },
        },
      },
      delete: {
        tags: ["Links"],
        summary: "Delete a link",
        description: "Deletes the link and its click log.",
        security: [{ session: [] }, { BearerAuth: [] }],
        parameters: [{ $ref: "#/components/parameters/KeywordPath" }],
        responses: {
          "200": {
            description: "Deleted",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiSuccessEnvelope" },
                example: { success: true, statusCode: 200, data: { deleted: "my-link" } },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
    },
    "/api/v1/links/{keyword}/clicks": {
      get: {
        tags: ["Stats"],
        summary: "Get the raw click log for a link",
        security: [{ session: [] }, { BearerAuth: [] }],
        parameters: [
          { $ref: "#/components/parameters/KeywordPath" },
          { name: "page", in: "query", schema: { type: "integer", minimum: 1, default: 1 } },
          { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 100, default: 50 } },
        ],
        responses: {
          "200": {
            description: "Paginated click log",
            content: {
              "application/json": {
                schema: {
                  allOf: [
                    { $ref: "#/components/schemas/ApiSuccessEnvelope" },
                    {
                      type: "object",
                      properties: {
                        data: {
                          type: "object",
                          properties: {
                            clicks: { type: "array", items: { $ref: "#/components/schemas/Click" } },
                            pagination: { $ref: "#/components/schemas/Pagination" },
                          },
                        },
                      },
                    },
                  ],
                },
              },
            },
          },
          "400": { $ref: "#/components/responses/ValidationError" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
          "429": { $ref: "#/components/responses/RateLimited" },
          "500": { $ref: "#/components/responses/InternalError" },
        },
      },
    },
    "/api/v1/links/{keyword}/qr": {
      post: {
        tags: ["Links"],
        summary: "Generate a QR code for a link",
        security: [{ session: [] }, { BearerAuth: [] }],
        parameters: [{ $ref: "#/components/parameters/KeywordPath" }],
        responses: {
          "200": {
            description: "QR code as inline SVG",
            content: {
              "application/json": {
                schema: {
                  allOf: [
                    { $ref: "#/components/schemas/ApiSuccessEnvelope" },
                    {
                      type: "object",
                      properties: {
                        data: {
                          type: "object",
                          properties: {
                            keyword: { type: "string" },
                            shortUrl: { type: "string", format: "uri" },
                            svg: { type: "string", description: "Inline SVG markup" },
                          },
                        },
                      },
                    },
                  ],
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
          "429": { $ref: "#/components/responses/RateLimited" },
          "500": { $ref: "#/components/responses/InternalError" },
        },
      },
    },
    "/api/v1/links/{keyword}/unlock": {
      post: {
        tags: ["Public"],
        summary: "Unlock a password-protected link",
        description:
          "Verifies a short link's password from the public /password/[keyword] page. Public — " +
          "not gated by session, since the visitor has not signed in. Guarded instead by a strict " +
          "per-IP rate limit against brute forcing.",
        security: [],
        parameters: [{ $ref: "#/components/parameters/KeywordPath" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["password"],
                properties: { password: { type: "string" } },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Password correct (or the link was not actually password-protected)",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiSuccessEnvelope" },
                example: { success: true, statusCode: 200, data: { url: "https://example.com/destination" } },
              },
            },
          },
          "400": {
            description: "Missing keyword or password",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiErrorEnvelope" },
                example: { success: false, statusCode: 400, error: "Keyword and password required" },
              },
            },
          },
          "403": {
            description: "Incorrect password",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiErrorEnvelope" },
                example: { success: false, statusCode: 403, error: "Incorrect password" },
              },
            },
          },
          "404": { $ref: "#/components/responses/NotFound" },
          "429": {
            description: "More than 5 attempts from this IP in the last minute",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiErrorEnvelope" },
                example: { success: false, statusCode: 429, error: "Too many attempts. Try again later." },
              },
            },
          },
          "500": { $ref: "#/components/responses/InternalError" },
        },
      },
    },
    "/api/v1/links/bulk": {
      post: {
        tags: ["Links"],
        summary: "Bulk-create links",
        security: [{ session: [] }, { BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "array",
                maxItems: 500,
                items: {
                  type: "object",
                  required: ["url"],
                  properties: {
                    url: { type: "string", format: "uri" },
                    keyword: { type: "string", maxLength: 100, pattern: "^[a-zA-Z0-9_-]*$" },
                    title: { type: "string", maxLength: 500 },
                  },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Per-item results — items are individually skipped (e.g. disallowed protocol, reserved or taken keyword), the request never fails as a whole",
            content: {
              "application/json": {
                schema: {
                  allOf: [
                    { $ref: "#/components/schemas/ApiSuccessEnvelope" },
                    {
                      type: "object",
                      properties: {
                        data: {
                          type: "object",
                          properties: {
                            results: {
                              type: "array",
                              items: {
                                type: "object",
                                properties: {
                                  keyword: { type: "string" },
                                  url: { type: "string" },
                                  status: { type: "string", enum: ["created", "skipped"] },
                                  reason: { type: "string" },
                                },
                              },
                            },
                            summary: {
                              type: "object",
                              properties: {
                                created: { type: "integer" },
                                skipped: { type: "integer" },
                                total: { type: "integer" },
                              },
                            },
                          },
                        },
                      },
                    },
                  ],
                },
              },
            },
          },
          "400": { $ref: "#/components/responses/ValidationError" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "429": { $ref: "#/components/responses/RateLimited" },
          "500": { $ref: "#/components/responses/InternalError" },
        },
      },
    },
    "/api/v1/links/export": {
      get: {
        tags: ["Links"],
        summary: "Export links as CSV",
        description: "Streams a CSV of the caller's links (or every link, for admins).",
        security: [{ session: [] }, { BearerAuth: [] }],
        responses: {
          "200": {
            description: "CSV file, streamed",
            content: {
              "text/csv": {
                schema: { type: "string" },
                example: "keyword,url,title,clicks,statusCode,createdAt\nmy-link,https://example.com,Example,42,301,2026-07-02T10:00:00.000Z\n",
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "429": { $ref: "#/components/responses/RateLimited" },
          "500": { $ref: "#/components/responses/InternalError" },
        },
      },
    },
    "/api/v1/stats/{keyword}": {
      get: {
        tags: ["Stats"],
        summary: "Get detailed analytics for a link",
        security: [{ session: [] }, { BearerAuth: [] }],
        parameters: [
          { $ref: "#/components/parameters/KeywordPath" },
          { name: "period", in: "query", schema: { type: "string", enum: ["24h", "7d", "30d", "all"], default: "all" } },
        ],
        responses: {
          "200": {
            description: "Referrer, country, browser, OS, and daily-timeline breakdowns for the period",
            content: {
              "application/json": {
                schema: {
                  allOf: [
                    { $ref: "#/components/schemas/ApiSuccessEnvelope" },
                    { type: "object", properties: { data: { $ref: "#/components/schemas/LinkStats" } } },
                  ],
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "404": { $ref: "#/components/responses/NotFound" },
          "429": { $ref: "#/components/responses/RateLimited" },
          "500": { $ref: "#/components/responses/InternalError" },
        },
      },
    },
    "/api/v1/user/stats": {
      get: {
        tags: ["Stats"],
        summary: "Get an at-a-glance dashboard summary for the caller",
        description:
          "Aggregates the caller's own links: totals, a 7-day click trend, top 5 links, and top 5 " +
          "countries. Not rate-limited beyond the platform's shared infrastructure limits.",
        security: [{ session: [] }, { BearerAuth: [] }],
        responses: {
          "200": {
            description: "Dashboard summary",
            content: {
              "application/json": {
                schema: {
                  allOf: [
                    { $ref: "#/components/schemas/ApiSuccessEnvelope" },
                    { type: "object", properties: { data: { $ref: "#/components/schemas/UserStats" } } },
                  ],
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "500": { $ref: "#/components/responses/InternalError" },
        },
      },
    },
    "/api/v1/auth/api-keys": {
      get: {
        tags: ["Account"],
        summary: "List your API keys",
        description: "Full key values are never persisted or returned again after creation; only the stored prefix is shown, suffixed with `...`.",
        security: [{ session: [] }],
        responses: {
          "200": {
            description: "Masked API key list",
            content: {
              "application/json": {
                schema: {
                  allOf: [
                    { $ref: "#/components/schemas/ApiSuccessEnvelope" },
                    {
                      type: "object",
                      properties: {
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
                                  key: { type: "string", example: "hmd_a1b2c3d4..." },
                                  createdAt: { type: "string", format: "date-time" },
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                  ],
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
      post: {
        tags: ["Account"],
        summary: "Create an API key",
        description: "The raw key (`hmd_...`) is returned exactly once, in this response, and is never persisted or logged again.",
        security: [{ session: [] }],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { label: { type: "string", maxLength: 100, default: "Default" } },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "API key created",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiSuccessEnvelope" },
                example: { success: true, statusCode: 201, data: { key: "hmd_9f8e7d...", label: "Default" } },
              },
            },
          },
          "400": { $ref: "#/components/responses/ValidationError" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "500": { $ref: "#/components/responses/InternalError" },
        },
      },
      delete: {
        tags: ["Account"],
        summary: "Revoke an API key",
        security: [{ session: [] }],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["id"],
                properties: { id: { type: "string", description: "API key _id, from the list endpoint" } },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "API key deleted (idempotent — succeeds even if the id did not match)",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiSuccessEnvelope" },
                example: { success: true, statusCode: 200, data: { message: "API key deleted" } },
              },
            },
          },
          "400": {
            description: "Missing id",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiErrorEnvelope" },
                example: { success: false, statusCode: 400, error: "API key id required" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "500": { $ref: "#/components/responses/InternalError" },
        },
      },
    },
    "/api/v1/auth/password": {
      put: {
        tags: ["Account"],
        summary: "Change your password",
        security: [{ session: [] }, { BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["currentPassword", "newPassword"],
                properties: {
                  currentPassword: { type: "string", minLength: 1 },
                  newPassword: { type: "string", minLength: 8, maxLength: 200 },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Password changed",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiSuccessEnvelope" },
                example: { success: true, statusCode: 200, data: { message: "Password changed successfully" } },
              },
            },
          },
          "400": { $ref: "#/components/responses/ValidationError" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": {
            description: "Current password is incorrect",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiErrorEnvelope" },
                example: { success: false, statusCode: 403, error: "Current password is incorrect" },
              },
            },
          },
          "404": { $ref: "#/components/responses/NotFound" },
          "429": { $ref: "#/components/responses/RateLimited" },
          "500": { $ref: "#/components/responses/InternalError" },
        },
      },
    },
    "/api/v1/auth/signup": {
      post: {
        tags: ["Auth"],
        summary: "Register a new account",
        description:
          "Creates a user with status `pending` and `isVerified: false`, and sends a verification " +
          "email. Verifying the email (see /api/v1/auth/verify) does not itself grant access — an " +
          "admin must also approve the account (see PATCH /api/v1/admin/users/{id}, action `approve`) " +
          "before the user can sign in.",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/SignupRequest" },
              example: { email: "jane@example.com", username: "jane", password: "correct-horse-battery" },
            },
          },
        },
        responses: {
          "201": {
            description: "Account created",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiSuccessEnvelope" },
                example: {
                  success: true,
                  statusCode: 201,
                  data: {
                    message:
                      "Account created. Check your email to verify. After verification, an admin will review your account.",
                    username: "jane",
                  },
                },
              },
            },
          },
          "400": {
            description: "Validation error, or a reserved keyword used as username",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiErrorEnvelope" },
                example: { success: false, statusCode: 400, error: "This username is not available" },
              },
            },
          },
          "409": {
            description: "Email or username already taken",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiErrorEnvelope" },
                example: { success: false, statusCode: 409, error: "Email or username already taken" },
              },
            },
          },
          "429": { $ref: "#/components/responses/RateLimited" },
          "500": { $ref: "#/components/responses/InternalError" },
        },
      },
    },
    "/api/v1/auth/verify": {
      get: {
        tags: ["Auth"],
        summary: "Confirm a signup verification token",
        description:
          "Called from the link in the verification email. Marks the account `isVerified: true` and " +
          "notifies an admin that the account is pending approval, then redirects to `/login`. This is " +
          "a redirect endpoint, not a JSON API call — it never returns a JSON body on success.",
        security: [],
        parameters: [
          {
            name: "token",
            in: "query",
            required: true,
            schema: { type: "string" },
            description: "Verification token from the emailed link",
          },
        ],
        responses: {
          "302": {
            description: "Redirects to `/login?verified=1&pending=1`",
          },
          "400": {
            description: "Missing, invalid, or expired token",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiErrorEnvelope" },
                example: { success: false, statusCode: 400, error: "Invalid or expired verification token" },
              },
            },
          },
          "500": { $ref: "#/components/responses/InternalError" },
        },
      },
    },
    "/api/v1/auth/resend-verification": {
      post: {
        tags: ["Auth"],
        summary: "Resend the signup verification email",
        description:
          "Always returns the same success message regardless of whether the email exists or is " +
          "already verified, to prevent account enumeration.",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email"],
                properties: { email: { type: "string", format: "email" } },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Verification email sent, if applicable",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiSuccessEnvelope" },
                example: {
                  success: true,
                  statusCode: 200,
                  data: {
                    message: "If an unverified account exists with that email, a new verification link has been sent.",
                  },
                },
              },
            },
          },
          "400": {
            description: "Missing email",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiErrorEnvelope" },
                example: { success: false, statusCode: 400, error: "Email is required" },
              },
            },
          },
          "429": { $ref: "#/components/responses/RateLimited" },
          "500": { $ref: "#/components/responses/InternalError" },
        },
      },
    },
    "/api/v1/auth/email": {
      put: {
        tags: ["Account"],
        summary: "Request an email address change",
        description:
          "Requires the caller's current password. Sends a confirmation link to the CURRENT email " +
          "address (not the new one); the change only takes effect once that link is followed (see " +
          "/api/v1/auth/email/confirm). The new address is held in `pendingEmail` until then.",
        security: [{ session: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["newEmail", "currentPassword"],
                properties: {
                  newEmail: { type: "string", format: "email", maxLength: 200 },
                  currentPassword: { type: "string", minLength: 1 },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Confirmation email sent",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiSuccessEnvelope" },
                example: {
                  success: true,
                  statusCode: 200,
                  data: { message: "A confirmation email has been sent to your current email address." },
                },
              },
            },
          },
          "400": {
            description: "Validation error, or new email matches the current one",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiErrorEnvelope" },
                example: { success: false, statusCode: 400, error: "New email is the same as your current email" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": {
            description: "Current password is incorrect",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiErrorEnvelope" },
                example: { success: false, statusCode: 403, error: "Current password is incorrect" },
              },
            },
          },
          "404": { $ref: "#/components/responses/NotFound" },
          "409": {
            description: "New email already in use by another account",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiErrorEnvelope" },
                example: { success: false, statusCode: 409, error: "Email is already in use" },
              },
            },
          },
          "500": { $ref: "#/components/responses/InternalError" },
        },
      },
    },
    "/api/v1/auth/email/confirm": {
      get: {
        tags: ["Account"],
        summary: "Confirm a pending email address change",
        description:
          "Called from the link sent to the CURRENT email address by PUT /api/v1/auth/email. Applies " +
          "`pendingEmail` as the account's new email. This is a redirect endpoint — it always redirects " +
          "to `/login` with an `emailChange` query flag (`success`, `expired`, `taken`, `invalid`, or " +
          "`error`) and never returns a JSON body.",
        security: [],
        parameters: [
          {
            name: "token",
            in: "query",
            required: true,
            schema: { type: "string" },
            description: "Email-change token from the emailed link",
          },
        ],
        responses: {
          "302": {
            description: "Always redirects to `/login?emailChange=<status>`, regardless of outcome",
          },
        },
      },
    },
    "/api/v1/admin/users": {
      get: {
        tags: ["Admin"],
        summary: "List users",
        description: "Admin-only. Supports pagination, a case-insensitive username/email search, and status filtering.",
        security: [{ session: [] }, { BearerAuth: [] }],
        parameters: [
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "limit", in: "query", schema: { type: "integer", default: 20, maximum: 100 } },
          { name: "search", in: "query", schema: { type: "string" }, description: "Matched against username and email" },
          { name: "status", in: "query", schema: { type: "string", enum: ["pending", "approved", "disabled"] } },
        ],
        responses: {
          "200": {
            description: "Paginated user list, each with its link count",
            content: {
              "application/json": {
                schema: {
                  allOf: [
                    { $ref: "#/components/schemas/ApiSuccessEnvelope" },
                    {
                      type: "object",
                      properties: {
                        data: {
                          type: "object",
                          properties: {
                            users: { type: "array", items: { $ref: "#/components/schemas/AdminUser" } },
                            pagination: { $ref: "#/components/schemas/Pagination" },
                          },
                        },
                      },
                    },
                  ],
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/AdminOnly" },
          "429": { $ref: "#/components/responses/RateLimited" },
          "500": { $ref: "#/components/responses/InternalError" },
        },
      },
    },
    "/api/v1/admin/users/{id}": {
      patch: {
        tags: ["Admin"],
        summary: "Perform an action on a user account",
        description:
          "Admin-only. A single action-based endpoint rather than a general-purpose profile PATCH. " +
          "`approve` and `verify` clear the account's pending verification state; `approve` also emails " +
          "the user. An admin can never target their own account through this endpoint.",
        security: [{ session: [] }, { BearerAuth: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" }, description: "Target user's Mongo _id" },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/AdminUserActionRequest" },
              example: { action: "approve" },
            },
          },
        },
        responses: {
          "200": {
            description: "Updated user",
            content: {
              "application/json": {
                schema: {
                  allOf: [
                    { $ref: "#/components/schemas/ApiSuccessEnvelope" },
                    {
                      type: "object",
                      properties: {
                        data: {
                          type: "object",
                          properties: {
                            id: { type: "string" },
                            username: { type: "string" },
                            email: { type: "string", format: "email" },
                            role: { type: "string", enum: ["admin", "user"] },
                            isVerified: { type: "boolean" },
                            status: { type: "string", enum: ["pending", "approved", "disabled"] },
                          },
                        },
                      },
                    },
                  ],
                },
              },
            },
          },
          "400": {
            description: "Unknown action, self-modification attempt, or duplicate username/email in `editProfile`",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiErrorEnvelope" },
                example: { success: false, statusCode: 400, error: "Cannot modify your own account this way" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/AdminOnly" },
          "404": { $ref: "#/components/responses/NotFound" },
          "409": {
            description: "`editProfile` username or email already taken by another account",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiErrorEnvelope" },
                example: { success: false, statusCode: 409, error: "Username already taken" },
              },
            },
          },
          "429": { $ref: "#/components/responses/RateLimited" },
          "500": { $ref: "#/components/responses/InternalError" },
        },
      },
      delete: {
        tags: ["Admin"],
        summary: "Delete a user account",
        description:
          "Admin-only. The user's links are kept but unlinked (`owner` set to null) rather than " +
          "deleted. An admin can never delete their own account through this endpoint.",
        security: [{ session: [] }, { BearerAuth: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" }, description: "Target user's Mongo _id" },
        ],
        responses: {
          "200": {
            description: "User deleted",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiSuccessEnvelope" },
                example: { success: true, statusCode: 200, data: { message: "User jane deleted" } },
              },
            },
          },
          "400": {
            description: "Attempted to delete own account",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ApiErrorEnvelope" },
                example: { success: false, statusCode: 400, error: "Cannot delete your own account" },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/AdminOnly" },
          "404": { $ref: "#/components/responses/NotFound" },
          "429": { $ref: "#/components/responses/RateLimited" },
          "500": { $ref: "#/components/responses/InternalError" },
        },
      },
    },
    "/api/v1/admin/clicks": {
      get: {
        tags: ["Admin"],
        summary: "List clicks across all links, with the originating IP decrypted",
        description:
          "Admin-only. The only endpoint that decrypts and returns the raw IP address (from the " +
          "AES-256-GCM-encrypted `ipIv`/`ipRaw` fields on Click) — every other surface only ever " +
          "exposes the one-way analytics hash. Supports filtering by keyword, country, browser, and OS; " +
          "there is deliberately no IP filter, since encrypted values cannot be matched without " +
          "decrypting every row first.",
        security: [{ session: [] }, { BearerAuth: [] }],
        parameters: [
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "limit", in: "query", schema: { type: "integer", default: 50, maximum: 100 } },
          { name: "keyword", in: "query", schema: { type: "string" } },
          { name: "country", in: "query", schema: { type: "string" }, description: "ISO country code, case-insensitive" },
          { name: "browser", in: "query", schema: { type: "string" } },
          { name: "os", in: "query", schema: { type: "string" } },
        ],
        responses: {
          "200": {
            description: "Paginated click list with decrypted IP and linked keyword's title/url",
            content: {
              "application/json": {
                schema: {
                  allOf: [
                    { $ref: "#/components/schemas/ApiSuccessEnvelope" },
                    {
                      type: "object",
                      properties: {
                        data: {
                          type: "object",
                          properties: {
                            clicks: { type: "array", items: { $ref: "#/components/schemas/AdminClick" } },
                            total: { type: "integer" },
                            page: { type: "integer" },
                            pages: { type: "integer" },
                          },
                        },
                      },
                    },
                  ],
                },
              },
            },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/AdminOnly" },
          "429": { $ref: "#/components/responses/RateLimited" },
          "500": { $ref: "#/components/responses/InternalError" },
        },
      },
    },
  },
  components: {
    parameters: {
      KeywordPath: {
        name: "keyword",
        in: "path",
        required: true,
        schema: { type: "string" },
        description: "The short link's keyword",
      },
      Format: {
        name: "format",
        in: "query",
        required: false,
        schema: { type: "string", enum: ["json", "xml", "jsonp", "text"], default: "json" },
        description:
          "Response body format, supported by the shared `apiSuccess`/`apiError` helper in " +
          "src/lib/api-response.ts (jsonp honours an optional `callback` query param, defaulting to " +
          "`callback`). As of this writing NO route handler in src/app/api/v1/** or src/app/api/admin/** " +
          "actually forwards its `NextRequest` into `apiSuccess`/`apiError`, so this parameter is " +
          "currently a no-op everywhere in this API — every endpoint always returns `application/json` " +
          "regardless of `?format=`. Documented here because the capability exists in the response " +
          "layer and is expected to be wired up per-route; do not treat it as live until a route is " +
          "confirmed to pass `request` through.",
      },
    },
    responses: {
      ValidationError: {
        description: "Request failed schema validation",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ApiErrorEnvelope" },
            example: { success: false, statusCode: 400, error: "Invalid URL" },
          },
        },
      },
      Unauthorized: {
        description: "No session cookie present",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ApiErrorEnvelope" },
            example: { success: false, statusCode: 401, error: "Unauthorized" },
          },
        },
      },
      Forbidden: {
        description: "Signed in, but the caller does not own this resource",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ApiErrorEnvelope" },
            example: { success: false, statusCode: 403, error: "Forbidden — you do not own this resource" },
          },
        },
      },
      AdminOnly: {
        description: "Signed in, but the caller's role is not `admin`",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ApiErrorEnvelope" },
            example: { success: false, statusCode: 403, error: "Forbidden — admin access required" },
          },
        },
      },
      NotFound: {
        description: "No resource with that identifier",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ApiErrorEnvelope" },
            example: { success: false, statusCode: 404, error: "Link not found" },
          },
        },
      },
      RateLimited: {
        description:
          "Rate limit exceeded. Public endpoints allow 30 requests/minute per IP; " +
          "session-authenticated endpoints allow 100 requests/minute per user, unless a " +
          "stricter endpoint-specific limit is noted (e.g. the unlock endpoint's 5/minute).",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ApiErrorEnvelope" },
            example: { success: false, statusCode: 429, error: "Too many requests" },
          },
        },
      },
      InternalError: {
        description: "Unexpected server error",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ApiErrorEnvelope" },
            example: { success: false, statusCode: 500, error: "Internal server error" },
          },
        },
      },
    },
    schemas: {
      ApiSuccessEnvelope: {
        type: "object",
        properties: {
          success: { type: "boolean", example: true },
          statusCode: { type: "integer" },
          data: {},
        },
      },
      ApiErrorEnvelope: {
        type: "object",
        properties: {
          success: { type: "boolean", example: false },
          statusCode: { type: "integer" },
          error: { type: "string" },
        },
      },
      ShortenRequest: {
        type: "object",
        required: ["url"],
        properties: {
          url: { type: "string", format: "uri", description: "The URL to shorten" },
          keyword: {
            type: "string",
            minLength: 2,
            maxLength: 100,
            pattern: "^[a-zA-Z0-9_-]*$",
            description: "Custom keyword. Randomly generated when omitted.",
          },
          title: { type: "string", maxLength: 500 },
          turnstileToken: {
            type: "string",
            description: "Cloudflare Turnstile token, required unless dev mode",
          },
        },
      },
      ShortenResult: {
        type: "object",
        properties: {
          keyword: { type: "string" },
          url: { type: "string", format: "uri" },
          shortUrl: { type: "string", format: "uri" },
          title: { type: "string" },
          createdAt: { type: "string", format: "date-time" },
        },
      },
      EditLinkRequest: {
        type: "object",
        properties: {
          url: { type: "string", format: "uri" },
          title: { type: "string", maxLength: 500 },
          keyword: { type: "string", minLength: 2, maxLength: 100, pattern: "^[a-zA-Z0-9_-]+$" },
          statusCode: { type: "integer", enum: [301, 302] },
          isPasswordProtected: { type: "boolean" },
          password: { type: "string", minLength: 1, maxLength: 200 },
          removePassword: { type: "boolean" },
          expiresAt: { type: "string", format: "date-time", nullable: true },
          ogTitle: { type: "string", maxLength: 200, nullable: true },
          ogDescription: { type: "string", maxLength: 500, nullable: true },
          ogImage: { type: "string", format: "uri", nullable: true },
        },
      },
      Link: {
        type: "object",
        properties: {
          keyword: { type: "string" },
          url: { type: "string", format: "uri" },
          title: { type: "string" },
          clicks: { type: "integer" },
          statusCode: { type: "integer", enum: [301, 302] },
          isPasswordProtected: { type: "boolean" },
          expiresAt: { type: "string", format: "date-time", nullable: true },
          ogTitle: { type: "string", nullable: true },
          ogDescription: { type: "string", nullable: true },
          ogImage: { type: "string", nullable: true },
          owner: { type: "string", nullable: true, description: "Owning user's id, or null for anonymously created links" },
          createdVia: { type: "string", enum: ["form", "api", "bulk", "dashboard"] },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
        },
      },
      Click: {
        type: "object",
        properties: {
          keyword: { type: "string" },
          referrer: { type: "string" },
          countryCode: { type: "string" },
          browser: { type: "string" },
          os: { type: "string" },
          createdAt: { type: "string", format: "date-time" },
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
      LinkStats: {
        type: "object",
        properties: {
          keyword: { type: "string" },
          url: { type: "string", format: "uri" },
          title: { type: "string" },
          clicks: { type: "integer" },
          clicksInPeriod: { type: "integer" },
          period: { type: "string", enum: ["24h", "7d", "30d", "all"] },
          createdAt: { type: "string", format: "date-time" },
          bestDay: {
            type: "object",
            nullable: true,
            properties: { date: { type: "string" }, count: { type: "integer" } },
          },
          directCount: { type: "integer" },
          referredCount: { type: "integer" },
          directPercent: { type: "integer" },
          uniqueReferrers: { type: "integer" },
          uniqueCountries: { type: "integer" },
          referrers: {
            type: "array",
            items: {
              type: "object",
              properties: { referrer: { type: "string" }, count: { type: "integer" } },
            },
          },
          countries: {
            type: "array",
            items: {
              type: "object",
              properties: { code: { type: "string" }, count: { type: "integer" } },
            },
          },
          timeline: {
            type: "array",
            items: {
              type: "object",
              properties: { date: { type: "string" }, count: { type: "integer" } },
            },
          },
          browsers: {
            type: "array",
            items: {
              type: "object",
              properties: { name: { type: "string" }, count: { type: "integer" } },
            },
          },
          operatingSystems: {
            type: "array",
            items: {
              type: "object",
              properties: { name: { type: "string" }, count: { type: "integer" } },
            },
          },
        },
      },
      SignupRequest: {
        type: "object",
        required: ["email", "username", "password"],
        properties: {
          email: { type: "string", format: "email" },
          username: {
            type: "string",
            minLength: 3,
            maxLength: 30,
            pattern: "^[a-zA-Z0-9_-]+$",
            description: "Alphanumeric, hyphens, and underscores only. Reserved keywords are rejected.",
          },
          password: { type: "string", minLength: 8, maxLength: 200 },
          turnstileToken: {
            type: "string",
            description: "Accepted by the request schema but not currently verified server-side by this endpoint.",
          },
        },
      },
      AdminUser: {
        type: "object",
        properties: {
          username: { type: "string" },
          email: { type: "string", format: "email" },
          role: { type: "string", enum: ["admin", "user"] },
          isVerified: { type: "boolean" },
          status: { type: "string", enum: ["pending", "approved", "disabled"] },
          createdAt: { type: "string", format: "date-time" },
          linkCount: { type: "integer" },
        },
      },
      AdminUserActionRequest: {
        type: "object",
        required: ["action"],
        properties: {
          action: {
            type: "string",
            enum: ["approve", "disable", "enable", "verify", "promote", "demote", "editProfile"],
          },
          username: { type: "string", description: "Only used with action `editProfile`" },
          email: { type: "string", format: "email", description: "Only used with action `editProfile`" },
        },
      },
      AdminClick: {
        type: "object",
        properties: {
          id: { type: "string" },
          keyword: { type: "string" },
          linkTitle: { type: "string" },
          linkUrl: { type: "string", format: "uri" },
          createdAt: { type: "string", format: "date-time" },
          ip: { type: "string", description: "Decrypted IP address, admin-only. Empty string if not recorded." },
          countryCode: { type: "string" },
          browser: { type: "string" },
          os: { type: "string" },
          referrer: { type: "string" },
          userAgent: { type: "string" },
        },
      },
      UserStats: {
        type: "object",
        properties: {
          totalLinks: { type: "integer" },
          totalClicks: { type: "integer" },
          avgClicks: { type: "integer" },
          clicks24h: { type: "integer" },
          weeklyTrend: {
            type: "array",
            items: {
              type: "object",
              properties: { date: { type: "string" }, count: { type: "integer" } },
            },
          },
          topLinks: {
            type: "array",
            items: {
              type: "object",
              properties: {
                keyword: { type: "string" },
                url: { type: "string", format: "uri" },
                title: { type: "string" },
                clicks: { type: "integer" },
              },
            },
          },
          topCountries: {
            type: "array",
            items: {
              type: "object",
              properties: { code: { type: "string" }, count: { type: "integer" } },
            },
          },
        },
      },
    },
    securitySchemes: {
      session: {
        type: "apiKey",
        in: "cookie",
        name: "authjs.session-token",
        description:
          "Dashboard session cookie, issued on sign-in at /login. Accepted alongside a Bearer " +
          "API key (see BearerAuth) by /api/v1/links/**, /api/v1/stats/**, /api/v1/user/stats, " +
          "/api/v1/admin/**, and /api/v1/auth/password. /api/v1/auth/api-keys and " +
          "/api/v1/auth/email (and /email/confirm) are session-only by design — you shouldn't " +
          "need an API key to manage API keys or change the account's own email. " +
          "/api/v1/admin/** additionally requires the signed-in user's `role` to be `admin`; there " +
          "is no separate security scheme for this, it's an in-handler check enforced after " +
          "authentication succeeds. /api/v1/auth/signup, /api/v1/auth/verify, and " +
          "/api/v1/auth/resend-verification require no authentication at all.",
      },
      BearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "hmd_<64 hex chars>",
        description:
          "API key issued from /api/v1/auth/api-keys, sent as `Authorization: Bearer hmd_...`. " +
          "Accepted as an alternative to the session cookie everywhere `session` is listed above " +
          "(except the two session-only endpoints noted there). The key is validated by hashing " +
          "the provided value and comparing against the stored hash — the raw key itself is never " +
          "persisted after creation.",
      },
    },
  },
};

/**
 * Deliberately NOT documented above because they are not implemented in this
 * codebase — do not re-add them without a corresponding route handler:
 *   - /api/v1/auth/register (the real signup path is /api/v1/auth/signup)
 *   - /api/v1/user/api-keys (the real path is /api/v1/auth/api-keys)
 *   - /api/v1/user/links (the real path is /api/v1/links)
 *
 * /api/v1/admin/users, /api/v1/admin/users/{id}, /api/v1/admin/clicks,
 * /api/v1/auth/signup, /api/v1/auth/verify, /api/v1/auth/resend-verification,
 * /api/v1/auth/email, and /api/v1/auth/email/confirm ARE implemented (routes
 * confirmed under src/app/api/v1/** as of this writing) and are documented
 * above under the Auth and Admin tags.
 *
 * Response-format negotiation (?format=json|xml|jsonp|text, see the shared
 * `Format` query parameter above) is implemented in
 * src/lib/api-response.ts, but as of this writing no route handler under
 * src/app/api/v1/** or src/app/api/admin/** forwards its `NextRequest` into
 * `apiSuccess`/`apiError` to activate it — every endpoint here only ever
 * returns the format shown (JSON, or CSV for the export endpoint), whatever
 * `?format=` is passed.
 */
