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
    {
      name: "Auth",
      description: "Registration and email verification",
    },
    {
      name: "User",
      description: "Authenticated user endpoints (Bearer API key required)",
    },
    {
      name: "Domains",
      description:
        "Custom domain management (Bearer API key required). Attach your own hostname, verify ownership via a DNS TXT record, and once Vercel has provisioned it, create short links on it through /api/v1/shorten and /api/v1/links.",
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
                  domain: {
                    type: "string",
                    description:
                      "Hostname to create the link on. Omit for the primary domain (hmd.bio). A custom domain requires a Bearer API key belonging to the domain's owner, and the domain must have status `active`; anonymous (Turnstile-only) requests can only use the primary domain.",
                  },
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
                        domain: { type: "string" },
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
          "403": {
            description:
              "The requested domain is not the primary domain and either the caller is unauthenticated, or the domain is not an active domain owned by the caller",
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
    "/api/v1/auth/register": {
      post: {
        tags: ["Auth"],
        summary: "Register a new account",
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
    "/api/v1/user/links": {
      get: {
        tags: ["User"],
        summary: "List your links",
        description: "Returns links created by the authenticated user.",
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "limit", in: "query", schema: { type: "integer", default: 15, maximum: 100 } },
          {
            name: "domain",
            in: "query",
            required: false,
            schema: { type: "string" },
            description:
              "Filter to a single hostname. Omitted lists links across every domain the caller owns (admins see every domain).",
          },
        ],
        responses: {
          "200": {
            description: "Paginated list of the user's links",
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
                          items: {
                            type: "object",
                            properties: {
                              keyword: { type: "string" },
                              domain: { type: "string" },
                              shortUrl: { type: "string" },
                              url: { type: "string" },
                              title: { type: "string" },
                              clicks: { type: "integer" },
                              createdAt: { type: "string", format: "date-time" },
                            },
                          },
                        },
                        pagination: {
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
                  },
                },
              },
            },
          },
          "400": { description: "Invalid query parameter (e.g. malformed domain)" },
          "401": { description: "Unauthorized" },
          "429": { description: "Rate limited (per-tier)" },
        },
      },
    },
    "/api/v1/links/{keyword}": {
      get: {
        tags: ["User"],
        summary: "Get one link",
        description:
          "Returns a single link owned by the authenticated user (or any link, for an admin).",
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: "keyword", in: "path", required: true, schema: { type: "string" } },
          {
            name: "domain",
            in: "query",
            required: false,
            schema: { type: "string" },
            description:
              "Hostname the link lives on. Defaults to the primary domain (hmd.bio) when omitted.",
          },
        ],
        responses: {
          "200": {
            description: "The link",
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
                        domain: { type: "string" },
                        shortUrl: { type: "string" },
                        url: { type: "string" },
                        title: { type: "string" },
                        clicks: { type: "integer" },
                        createdAt: { type: "string", format: "date-time" },
                      },
                    },
                  },
                },
              },
            },
          },
          "400": { description: "Invalid domain query parameter" },
          "401": { description: "Unauthorized" },
          "403": { description: "Link belongs to another user" },
          "404": { description: "Link not found" },
          "429": { description: "Rate limited (per-tier)" },
        },
      },
      put: {
        tags: ["User"],
        summary: "Edit a link",
        description:
          "Updates a link owned by the authenticated user. The `?domain=` query parameter, when present, selects which domain's link to edit and takes precedence over `domain` in the request body; both default to the primary domain. This never moves a link between domains.",
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: "keyword", in: "path", required: true, schema: { type: "string" } },
          {
            name: "domain",
            in: "query",
            required: false,
            schema: { type: "string" },
            description: "Overrides the `domain` field in the request body when present.",
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  domain: {
                    type: "string",
                    description:
                      "Hostname the link currently lives on. Ignored if `?domain=` is present. Defaults to the primary domain.",
                  },
                  url: { type: "string", format: "uri" },
                  title: { type: "string", maxLength: 500 },
                  keyword: {
                    type: "string",
                    minLength: 2,
                    maxLength: 100,
                    description: "Renames the link's keyword on the same domain",
                  },
                  statusCode: { type: "string", enum: ["301", "302"] },
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
          "400": { description: "Validation error" },
          "401": { description: "Unauthorized" },
          "403": { description: "Link belongs to another user" },
          "404": { description: "Link not found" },
          "409": { description: "New keyword already in use on that domain" },
          "429": { description: "Rate limited (per-tier)" },
        },
      },
      delete: {
        tags: ["User"],
        summary: "Delete a link",
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: "keyword", in: "path", required: true, schema: { type: "string" } },
          {
            name: "domain",
            in: "query",
            required: false,
            schema: { type: "string" },
            description: "Hostname the link lives on. Defaults to the primary domain.",
          },
        ],
        responses: {
          "200": { description: "Link and its click logs deleted" },
          "400": { description: "Invalid domain query parameter" },
          "401": { description: "Unauthorized" },
          "403": { description: "Link belongs to another user" },
          "404": { description: "Link not found" },
          "429": { description: "Rate limited (per-tier)" },
        },
      },
    },
    "/api/v1/domains": {
      get: {
        tags: ["Domains"],
        summary: "List your custom domains",
        security: [{ BearerAuth: [] }],
        responses: {
          "200": {
            description: "The caller's domains and their per-user cap",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean" },
                    data: {
                      type: "object",
                      properties: {
                        domains: {
                          type: "array",
                          items: { $ref: "#/components/schemas/Domain" },
                        },
                        limit: {
                          type: "integer",
                          description: "Maximum number of domains this user may attach",
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          "401": { description: "Unauthorized" },
          "429": { description: "Rate limited (per-tier)" },
        },
      },
      post: {
        tags: ["Domains"],
        summary: "Claim a domain",
        description:
          "Registers a hostname you own. The domain starts in `pending_dns`; create the returned TXT record, then call POST /api/v1/domains/{hostname}/verify.",
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["hostname"],
                properties: {
                  hostname: {
                    type: "string",
                    description:
                      "Bare hostname (no scheme, port, path, or leading 'www.'). Cannot be hmd.bio or a subdomain of it, and cannot match the impersonation blocklist.",
                  },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Domain claimed, awaiting DNS verification",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean" },
                    data: {
                      type: "object",
                      properties: {
                        hostname: { type: "string" },
                        status: { type: "string", example: "pending_dns" },
                        linkCount: { type: "integer" },
                        createdAt: { type: "string", format: "date-time" },
                        dnsRecord: { $ref: "#/components/schemas/DnsRecord" },
                        nextStep: { type: "string" },
                      },
                    },
                  },
                },
              },
            },
          },
          "400": { description: "Validation error (invalid hostname, blocked, or platform domain)" },
          "401": { description: "Unauthorized" },
          "403": {
            description: "The per-user domain cap has been reached",
          },
          "409": { description: "This domain is already claimed (by this or another user)" },
          "429": { description: "Rate limited (per-tier)" },
        },
      },
    },
    "/api/v1/domains/{hostname}": {
      get: {
        tags: ["Domains"],
        summary: "Get one domain",
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: "hostname", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": {
            description: "The domain",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean" },
                    data: { $ref: "#/components/schemas/Domain" },
                  },
                },
              },
            },
          },
          "400": { description: "Invalid hostname" },
          "401": { description: "Unauthorized" },
          "404": { description: "Domain not found (not owned by the caller, or does not exist)" },
          "429": { description: "Rate limited (per-tier)" },
        },
      },
      delete: {
        tags: ["Domains"],
        summary: "Remove a domain",
        description:
          "Detaches the hostname from the platform and deletes the domain record. Links already created on it are kept but will stop resolving; they are never deleted.",
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: "hostname", in: "path", required: true, schema: { type: "string" } },
          {
            name: "force",
            in: "query",
            required: false,
            schema: { type: "string", enum: ["true"] },
            description:
              "Required (set to \"true\") to remove a domain that still has links attached; otherwise the request is refused with 409.",
          },
        ],
        responses: {
          "200": {
            description: "Domain removed",
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
                        orphanedLinks: { type: "integer" },
                        message: { type: "string" },
                      },
                    },
                  },
                },
              },
            },
          },
          "400": { description: "Invalid hostname" },
          "401": { description: "Unauthorized" },
          "404": { description: "Domain not found" },
          "409": {
            description:
              "The domain still has links and `?force=true` was not supplied. The error message states how many links would be orphaned.",
          },
          "429": { description: "Rate limited (per-tier)" },
          "502": { description: "Vercel refused to detach the domain; retry" },
          "503": { description: "Domain management is temporarily unavailable" },
        },
      },
    },
    "/api/v1/domains/{hostname}/verify": {
      post: {
        tags: ["Domains"],
        summary: "Verify domain ownership and provision it",
        description:
          "Checks the DNS TXT record, attaches the hostname to the Vercel project, and polls briefly for certificate issuance. Idempotent: calling it again on an already-active domain simply confirms it is active, and calling it again on a `provisioning` domain re-checks Vercel's status without re-reading the TXT record.",
        security: [{ BearerAuth: [] }],
        parameters: [
          { name: "hostname", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": {
            description: "Domain is active (or already was)",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean" },
                    data: {
                      allOf: [
                        { $ref: "#/components/schemas/DomainVerifyResult" },
                        {
                          type: "object",
                          properties: {
                            message: {
                              type: "string",
                              example: "Domain is active",
                            },
                          },
                        },
                      ],
                    },
                  },
                },
              },
            },
          },
          "202": {
            description:
              "Ownership verified, but Vercel still reports the domain misconfigured (DNS does not yet point at Vercel). The domain remains in `provisioning`; the response lists the DNS records still required.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean" },
                    data: {
                      allOf: [
                        { $ref: "#/components/schemas/DomainVerifyResult" },
                        {
                          type: "object",
                          properties: {
                            message: {
                              type: "string",
                              example:
                                "Ownership verified. Finish DNS setup to bring the domain online.",
                            },
                            dnsRecord: { $ref: "#/components/schemas/DnsRecord" },
                            requiredRecords: {
                              type: "array",
                              description:
                                "CNAME and/or A records Vercel needs to route traffic to this hostname",
                              items: {
                                type: "object",
                                properties: {
                                  type: { type: "string", enum: ["CNAME", "A"] },
                                  name: { type: "string" },
                                  value: { type: "string" },
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
            },
          },
          "400": {
            description:
              "TXT record missing or does not match the expected token, or Vercel rejected the hostname/attachment. The domain transitions to `failed` and `failureReason` explains why.",
          },
          "401": { description: "Unauthorized" },
          "403": { description: "This domain is suspended" },
          "404": { description: "Domain not found" },
          "409": { description: "This domain is already attached to another Vercel project" },
          "429": { description: "Too many verification attempts (6/hour per user)" },
          "503": { description: "Domain provisioning is temporarily unavailable" },
        },
      },
    },
    "/api/v1/links/bulk": {
      post: {
        tags: ["User"],
        summary: "Bulk-import links",
        description:
          "Creates up to 500 links in one request. Never fails atomically: each row is validated and created independently, and per-row failures (bad protocol, keyword taken, domain not writable) are reported in `results` rather than aborting the batch.",
        security: [{ BearerAuth: [] }],
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
                    keyword: { type: "string", maxLength: 100 },
                    title: { type: "string", maxLength: 500 },
                    domain: {
                      type: "string",
                      description:
                        "Hostname for this row. Omit for the primary domain. A custom domain must be an active domain owned by the caller; each row is checked independently so a single import can span several domains.",
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Import processed (individual rows may still be skipped)",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean" },
                    data: {
                      type: "object",
                      properties: {
                        results: {
                          type: "array",
                          items: {
                            type: "object",
                            properties: {
                              keyword: { type: "string" },
                              domain: { type: "string" },
                              url: { type: "string" },
                              shortUrl: { type: "string" },
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
              },
            },
          },
          "400": { description: "Validation error (e.g. more than 500 rows)" },
          "401": { description: "Unauthorized" },
          "429": { description: "Rate limited (per-tier)" },
        },
      },
    },
    "/api/v1/user/api-keys": {
      get: {
        tags: ["User"],
        summary: "List your API keys",
        security: [{ BearerAuth: [] }],
        responses: {
          "200": { description: "List of masked API keys" },
          "401": { description: "Unauthorized" },
        },
      },
      post: {
        tags: ["User"],
        summary: "Create an API key",
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
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
          "201": { description: "API key created (shown only once)" },
          "400": { description: "Max 5 keys reached" },
          "401": { description: "Unauthorized" },
        },
      },
      delete: {
        tags: ["User"],
        summary: "Delete an API key",
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["id"],
                properties: {
                  id: { type: "string", description: "API key _id" },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "API key deleted" },
          "401": { description: "Unauthorized" },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      BearerAuth: {
        type: "http",
        scheme: "bearer",
        description: "API key starting with hmd_",
      },
    },
    schemas: {
      DnsRecord: {
        type: "object",
        properties: {
          recordType: { type: "string", enum: ["TXT"] },
          name: { type: "string", description: "e.g. _hmd-verify.example.com" },
          value: { type: "string" },
        },
      },
      Domain: {
        type: "object",
        properties: {
          hostname: { type: "string" },
          status: {
            type: "string",
            enum: [
              "pending_dns",
              "verifying",
              "provisioning",
              "active",
              "failed",
              "suspended",
            ],
            description:
              "pending_dns: claimed, TXT record not yet checked. verifying: TXT check in progress. provisioning: ownership proven, attached to Vercel, DNS/certificate not yet ready. active: serving traffic. failed: last verification attempt failed (see failureReason). suspended: disabled by an admin.",
          },
          verifiedAt: { type: "string", format: "date-time", nullable: true },
          linkCount: { type: "integer" },
          failureReason: { type: "string", nullable: true },
          createdAt: { type: "string", format: "date-time" },
          dnsRecord: {
            allOf: [{ $ref: "#/components/schemas/DnsRecord" }],
            nullable: true,
            description: "null once the domain is active; otherwise the TXT record still required",
          },
        },
      },
      DomainVerifyResult: {
        type: "object",
        properties: {
          hostname: { type: "string" },
          status: {
            type: "string",
            enum: ["provisioning", "active", "failed"],
            description: "The only statuses this endpoint can leave a domain in",
          },
          verifiedAt: { type: "string", format: "date-time", nullable: true },
          failureReason: { type: "string", nullable: true },
        },
      },
    },
  },
};
