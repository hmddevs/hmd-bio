export const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "HMD.bio API",
    version: "1.0.0",
    description: "URL shortening API by HMD Developments",
    contact: {
      name: "HMD Developments",
      url: "https://hmddevs.org",
    },
  },
  servers: [{ url: "https://hmd.bio", description: "Production" }],
  tags: [
    { name: "Public", description: "No authentication required" },
    { name: "Links", description: "Link management (auth required)" },
    { name: "Stats", description: "Analytics & statistics" },
    { name: "Auth", description: "API keys & password management" },
  ],
  paths: {
    "/api/v1/shorten": {
      post: {
        tags: ["Public"],
        summary: "Shorten a URL",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["url"],
                properties: {
                  url: { type: "string", format: "uri", description: "The URL to shorten" },
                  keyword: { type: "string", maxLength: 100, pattern: "^[a-zA-Z0-9_-]+$", description: "Custom keyword (optional)" },
                  title: { type: "string", maxLength: 500 },
                  turnstileToken: { type: "string", description: "Cloudflare Turnstile token (optional)" },
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
          "409": { description: "Keyword already taken" },
          "429": { description: "Rate limited" },
        },
      },
    },
    "/api/v1/expand": {
      get: {
        tags: ["Public"],
        summary: "Expand a short link",
        parameters: [
          { name: "keyword", in: "query", required: true, schema: { type: "string" } },
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
        },
      },
    },
    "/api/v1/links": {
      get: {
        tags: ["Links"],
        summary: "List all links",
        security: [{ session: [] }],
        parameters: [
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "limit", in: "query", schema: { type: "integer", default: 15, maximum: 100 } },
          { name: "search", in: "query", schema: { type: "string", maxLength: 200 } },
          { name: "sort", in: "query", schema: { type: "string", enum: ["keyword", "url", "clicks", "createdAt"] } },
          { name: "order", in: "query", schema: { type: "string", enum: ["asc", "desc"] } },
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
                  type: "object",
                  properties: {
                    success: { type: "boolean" },
                    data: {
                      type: "object",
                      properties: {
                        links: { type: "array", items: { $ref: "#/components/schemas/Link" } },
                        pagination: { $ref: "#/components/schemas/Pagination" },
                      },
                    },
                  },
                },
              },
            },
          },
          "401": { description: "Unauthorized" },
        },
      },
    },
    "/api/v1/links/{keyword}": {
      get: {
        tags: ["Links"],
        summary: "Get a link",
        security: [{ session: [] }],
        parameters: [
          { name: "keyword", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "Link details", content: { "application/json": { schema: { type: "object", properties: { success: { type: "boolean" }, data: { $ref: "#/components/schemas/Link" } } } } } },
          "404": { description: "Not found" },
        },
      },
      put: {
        tags: ["Links"],
        summary: "Update a link",
        security: [{ session: [] }],
        parameters: [
          { name: "keyword", in: "path", required: true, schema: { type: "string" } },
        ],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  url: { type: "string", format: "uri" },
                  title: { type: "string", maxLength: 500 },
                  keyword: { type: "string", maxLength: 100 },
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
            },
          },
        },
        responses: {
          "200": { description: "Updated link" },
          "404": { description: "Not found" },
        },
      },
      delete: {
        tags: ["Links"],
        summary: "Delete a link",
        security: [{ session: [] }],
        parameters: [
          { name: "keyword", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "Deleted" },
          "404": { description: "Not found" },
        },
      },
    },
    "/api/v1/links/{keyword}/clicks": {
      get: {
        tags: ["Stats"],
        summary: "Get click log for a link",
        security: [{ session: [] }],
        parameters: [
          { name: "keyword", in: "path", required: true, schema: { type: "string" } },
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "limit", in: "query", schema: { type: "integer", default: 50, maximum: 100 } },
        ],
        responses: {
          "200": { description: "Paginated clicks" },
        },
      },
    },
    "/api/v1/links/{keyword}/qr": {
      post: {
        tags: ["Links"],
        summary: "Generate QR code for a link",
        security: [{ session: [] }],
        parameters: [
          { name: "keyword", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": {
            description: "QR code SVG",
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
                        shortUrl: { type: "string" },
                        svg: { type: "string" },
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
    "/api/v1/links/bulk": {
      post: {
        tags: ["Links"],
        summary: "Bulk create links",
        security: [{ session: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "array",
                maxItems: 100,
                items: {
                  type: "object",
                  required: ["url"],
                  properties: {
                    url: { type: "string", format: "uri" },
                    keyword: { type: "string", maxLength: 100 },
                    title: { type: "string", maxLength: 500 },
                  },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Bulk results" },
        },
      },
    },
    "/api/v1/links/export": {
      get: {
        tags: ["Links"],
        summary: "Export links as CSV",
        security: [{ session: [] }],
        responses: {
          "200": {
            description: "CSV file",
            content: { "text/csv": { schema: { type: "string" } } },
          },
        },
      },
    },
    "/api/v1/stats/{keyword}": {
      get: {
        tags: ["Stats"],
        summary: "Get detailed stats for a link",
        security: [{ session: [] }],
        parameters: [
          { name: "keyword", in: "path", required: true, schema: { type: "string" } },
          { name: "period", in: "query", schema: { type: "string", enum: ["24h", "7d", "30d", "all"], default: "all" } },
        ],
        responses: {
          "200": { description: "Detailed analytics" },
        },
      },
    },
    "/api/v1/auth/api-keys": {
      get: {
        tags: ["Auth"],
        summary: "List API keys",
        security: [{ session: [] }],
        responses: {
          "200": { description: "API key list" },
        },
      },
      post: {
        tags: ["Auth"],
        summary: "Create an API key",
        security: [{ session: [] }],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  label: { type: "string", maxLength: 100, default: "Default" },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "API key created" },
        },
      },
      delete: {
        tags: ["Auth"],
        summary: "Delete an API key",
        security: [{ session: [] }],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["id"],
                properties: {
                  id: { type: "string", description: "API key ID" },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "API key deleted" },
        },
      },
    },
    "/api/v1/auth/password": {
      put: {
        tags: ["Auth"],
        summary: "Change password",
        security: [{ session: [] }],
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
          "200": { description: "Password changed" },
          "400": { description: "Invalid current password" },
        },
      },
    },
  },
  components: {
    schemas: {
      Link: {
        type: "object",
        properties: {
          keyword: { type: "string" },
          url: { type: "string" },
          title: { type: "string" },
          clicks: { type: "integer" },
          statusCode: { type: "integer", enum: [301, 302] },
          isPasswordProtected: { type: "boolean" },
          expiresAt: { type: "string", format: "date-time", nullable: true },
          ogTitle: { type: "string", nullable: true },
          ogDescription: { type: "string", nullable: true },
          ogImage: { type: "string", nullable: true },
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
    securitySchemes: {
      session: {
        type: "apiKey",
        in: "cookie",
        name: "next-auth.session-token",
        description: "Session cookie (sign in via /admin/login)",
      },
    },
  },
};
