import { z } from "zod";
import {
  isBlockedHostname,
  isPrimaryHost,
  PRIMARY_DOMAIN,
  PUBLIC_SUFFIXES,
} from "@/lib/domains";

// --- Hostname primitives -------------------------------------------------
// Defined first because the link schemas below carry a `domain` field.

const IPV4_LITERAL = /^\d{1,3}(\.\d{1,3}){3}$/;
const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Syntactic hostname check only: shape, length, and label rules. It does not
 * apply the blocklist, so it accepts the primary domain and is the right base
 * for query parameters. Use `domainSchema` for anything a user is claiming.
 */
export const hostnameSyntaxSchema = z
  .string()
  .min(1, "Hostname is required")
  .max(300, "Hostname is too long")
  .transform((value) => value.trim().toLowerCase())
  .superRefine((value, ctx) => {
    const fail = (message: string) =>
      ctx.addIssue({ code: "custom", message });

    if (value.length === 0) return fail("Hostname is required");
    if (value.length > 253) return fail("Hostname must be at most 253 characters");
    if (/[:\/?#@\s]/.test(value)) {
      return fail("Enter a bare hostname: no scheme, port, path, or credentials");
    }
    if (value.startsWith(".") || value.endsWith(".")) {
      return fail("Hostname must not start or end with a dot");
    }
    if (value.includes("..")) return fail("Hostname must not contain an empty label");
    if (!value.includes(".")) return fail("Hostname must include at least one dot");
    if (IPV4_LITERAL.test(value)) return fail("An IP address cannot be used as a domain");
    if (/^[0-9a-f]*:/i.test(value) || value.includes("[")) {
      return fail("An IP address cannot be used as a domain");
    }

    const labels = value.split(".");
    for (const label of labels) {
      if (label.length === 0) return fail("Hostname must not contain an empty label");
      if (label.length > 63) return fail("Each label must be at most 63 characters");
      if (!LABEL.test(label)) {
        return fail(
          "Labels may contain only letters, digits, and hyphens, and must not start or end with a hyphen"
        );
      }
    }

    const tld = labels[labels.length - 1];
    if (!/^[a-z]{2,}$/.test(tld)) {
      return fail("The top-level domain must be alphabetic and at least two characters");
    }
  });

/**
 * A `domain` field on a link payload: a valid hostname, defaulting to the
 * primary domain when the client omits it. Ownership and `active` status are
 * enforced by the route, not here, because they need a database read.
 */
const linkDomainField = hostnameSyntaxSchema.default(PRIMARY_DOMAIN);

export const shortenSchema = z.object({
  url: z.string().url("Invalid URL"),
  keyword: z
    .string()
    .min(2, "Keyword must be at least 2 characters")
    .regex(/^[a-zA-Z0-9_-]*$/, "Only alphanumeric, hyphens, and underscores allowed")
    .max(100)
    .optional(),
  title: z.string().max(500).optional(),
  /**
   * The domain the link is created on. Absent means the primary domain, so an
   * existing client that has never heard of custom domains is unaffected.
   * Validated as a hostname, never accepted as a free-form string.
   */
  domain: linkDomainField,
  turnstileToken: z.string().optional(),
});

export const editLinkSchema = z.object({
  /**
   * Selects which domain the link being edited lives on; it does not move the
   * link. Moving a link between domains would change its public URL and is out
   * of scope, so `domain` is only ever used in the lookup filter.
   */
  domain: linkDomainField,
  url: z.string().url("Invalid URL").optional(),
  title: z.string().max(500).optional(),
  keyword: z
    .string()
    .min(2, "Keyword must be at least 2 characters")
    .regex(/^[a-zA-Z0-9_-]+$/)
    .max(100)
    .optional(),
  statusCode: z.coerce.string().pipe(z.enum(["301", "302"])).optional(),
  isPasswordProtected: z.boolean().optional(),
  password: z.string().min(1).max(200).optional(),
  removePassword: z.boolean().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  ogTitle: z.string().max(200).nullable().optional(),
  ogDescription: z.string().max(500).nullable().optional(),
  ogImage: z.string().url().nullable().optional(),
});

export const linksQuerySchema = z.object({
  /**
   * Deliberately has no default, unlike the `domain` field on the link
   * payloads. Omitting it lists the caller's links across every domain they
   * own, which is what a dashboard wants; see the note in
   * `/api/v1/links/route.ts`.
   */
  domain: hostnameSyntaxSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(15),
  search: z.string().max(200).optional(),
  sort: z.enum(["keyword", "url", "clicks", "createdAt"]).default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  minClicks: z.coerce.number().int().min(0).optional(),
  maxClicks: z.coerce.number().int().min(0).optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(200),
});

export const changeEmailSchema = z.object({
  newEmail: z.string().email("Invalid email address").max(200),
  currentPassword: z.string().min(1),
});

export const bulkImportSchema = z
  .array(
    z.object({
      url: z.string().url(),
      keyword: z
        .string()
        .regex(/^[a-zA-Z0-9_-]*$/)
        .max(100)
        .optional(),
      title: z.string().max(500).optional(),
      // Per-item so a single import can span several of the caller's domains.
      // Omitted means the primary domain, matching the pre-custom-domain shape.
      domain: linkDomainField,
    })
  )
  .max(500, "A bulk import can contain at most 500 links");

export const apiKeySchema = z.object({
  label: z.string().min(1).max(100).default("Default"),
});

export const signupSchema = z.object({
  email: z.email("Invalid email address"),
  username: z
    .string()
    .min(3, "Username must be at least 3 characters")
    .max(30)
    .regex(/^[a-zA-Z0-9_-]+$/, "Only alphanumeric, hyphens, and underscores allowed"),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
  turnstileToken: z.string().optional(),
});

export const adminEditProfileSchema = z.object({
  username: z
    .string()
    .min(3, "Username must be at least 3 characters")
    .max(30)
    .regex(/^[a-zA-Z0-9_-]+$/, "Only alphanumeric, hyphens, and underscores allowed")
    .optional(),
  email: z.email("Invalid email address").optional(),
});

// --- Custom domains -----------------------------------------------------

/**
 * A hostname a user may claim as their own. Adds the ownership rules on top of
 * the syntax check: nothing on the platform's own domain, nothing on the
 * impersonation blocklist, and no "www." host (which resolution normalises
 * away, so it could never serve links).
 */
/**
 * The suffix list lives in `@/lib/domains`, which also uses it for apex
 * detection. The syntax check only requires one dot, so `co.uk` passes it and
 * would otherwise be accepted as a registrable domain.
 */
export const hostnameSchema = hostnameSyntaxSchema.superRefine((value, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: "custom", message });

  if (PUBLIC_SUFFIXES.has(value)) {
    return fail("That is a public suffix, not a registrable domain");
  }
  if (value.startsWith("www.")) {
    return fail("Use the bare hostname without the leading 'www.'");
  }
  if (isPrimaryHost(value) || value === PRIMARY_DOMAIN || value.endsWith(`.${PRIMARY_DOMAIN}`)) {
    return fail(`${PRIMARY_DOMAIN} and its subdomains cannot be claimed`);
  }
  if (isBlockedHostname(value)) {
    return fail("This domain cannot be added");
  }
});

export const domainSchema = z.object({
  hostname: hostnameSchema,
});

/** Optional `?domain=` filter. Accepts the primary domain as well as custom ones. */
export const domainQuerySchema = z.object({
  domain: hostnameSyntaxSchema.optional(),
});
