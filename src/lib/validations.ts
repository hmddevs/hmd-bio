import { z } from "zod";
import {
  isBlockedHostname,
  isPrimaryHost,
  PRIMARY_DOMAIN,
  PUBLIC_SUFFIXES,
} from "@/lib/domains";
// Imported rather than restated: the API cap and the schema's `maxlength` must
// never drift, or a body that validates here fails at the database instead.
import { APP_LINKS_MAXLENGTH } from "@/models/Domain";

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

// --- Deeplink primitives -------------------------------------------------
// Shared by the link payloads below and by `deeplinkConfigSchema` further
// down; declared here because `shortenSchema` carries `targets`.

/**
 * An absolute http(s) URL the platform is willing to redirect a visitor to.
 *
 * Write-time scheme validation is the primary open-redirect guard for every
 * target introduced by deeplinks. `parseHttpUrl` in `@/lib/deeplink` re-checks
 * on read, but that is a backstop for rows written before this existed, not the
 * control: a `javascript:` or `data:` value must never reach the database in
 * the first place. Userinfo is rejected on top of the scheme check because
 * "https://trusted.example@evil.example" reads as the trusted host to a person
 * and resolves to the attacker's.
 *
 * The schema deliberately outputs the *parsed* URL rather than the raw input.
 * WHATWG parsing strips every tab, CR and LF anywhere in the string before it
 * looks at the host, so validating the parse while storing the original lets
 * the two disagree: "https://good.com<TAB>.evil.com/" validates as one host and
 * would be stored, displayed on the dashboard and shown in the public
 * /stats/{keyword}+ preview as another. Normalising here is the only place that
 * guarantees what a reviewer reads is what a visitor resolves.
 */
const absoluteHttpUrl = z
  .string()
  .min(1, "URL is required")
  .max(2048, "URL is too long")
  .transform((value, ctx) => {
    const fail = (message: string) => {
      ctx.addIssue({ code: "custom", message });
      return z.NEVER;
    };

    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return fail("Enter an absolute URL, including https://");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return fail("Only http and https URLs are allowed");
    }
    if (url.username || url.password) {
      return fail("A URL must not contain credentials");
    }
    return url.toString();
  });

/**
 * Per-platform overrides. Capped at three because there are exactly three
 * platform buckets (`platformFromUA`), and duplicates are rejected rather than
 * last-one-wins: two entries for the same platform have no defined meaning and
 * would make the resolved target depend on array order.
 */
const linkTargetsField = z
  .array(
    z.object({
      platform: z.enum(["ios", "android", "desktop"]),
      url: absoluteHttpUrl,
    })
  )
  .max(3, "At most three platform targets are allowed")
  .superRefine((targets, ctx) => {
    const seen = new Set<string>();
    for (const target of targets) {
      if (seen.has(target.platform)) {
        ctx.addIssue({
          code: "custom",
          message: `Duplicate target for platform "${target.platform}"`,
        });
        return;
      }
      seen.add(target.platform);
    }
  });

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
  /**
   * Deeplink fields. All optional, and all inert when omitted: a link created
   * without them resolves through `url` exactly as every existing link does.
   */
  targets: linkTargetsField.optional(),
  forwardPath: z.boolean().optional(),
  forwardQuery: z.boolean().optional(),
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
  /**
   * Absent leaves the stored value alone; an empty array clears every override
   * and returns the link to resolving through `url` alone. There is no partial
   * update of a single platform, so the client always sends the whole set.
   */
  targets: linkTargetsField.optional(),
  forwardPath: z.boolean().optional(),
  forwardQuery: z.boolean().optional(),
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

// --- Deeplink configuration ---------------------------------------------

/** UTF-8 size of a string, which is what actually goes over the wire. */
function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

/**
 * Rejects characters that cannot survive being served as `application/json`.
 *
 * Two classes matter. An unpaired surrogate has no UTF-8 encoding at all, so
 * the runtime substitutes U+FFFD and the bytes Apple or Google fetch are not
 * the bytes the customer saved. A raw control character is not legal inside a
 * JSON string and, since the file is served verbatim rather than re-serialised,
 * nothing downstream would escape it for us. Tab, newline and carriage return
 * are allowed because they are ordinary whitespace between tokens.
 */
function hasUnserialisableChars(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);

    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) return true;

    // High surrogate: must be followed by a low surrogate.
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (Number.isNaN(next) || next < 0xdc00 || next > 0xdfff) return true;
      i++;
      continue;
    }
    // Low surrogate reached without a high one in front of it.
    if (code >= 0xdc00 && code <= 0xdfff) return true;
  }
  return false;
}

/**
 * Shared checks for both association files: they are stored and served as the
 * exact bytes supplied, so everything that could make those bytes unusable has
 * to be caught here. Deliberately validates the string and never re-serialises
 * it; `JSON.parse` then `JSON.stringify` reorders keys, and Apple's CDN caches
 * whatever it first served.
 */
function refineAssociationFile(
  value: string,
  ctx: z.RefinementCtx,
  kind: "aasa" | "assetlinks"
): void {
  const fail = (message: string) => ctx.addIssue({ code: "custom", message });

  if (byteLength(value) > APP_LINKS_MAXLENGTH) {
    return fail(`The file must be at most ${APP_LINKS_MAXLENGTH / 1024} KB`);
  }
  if (hasUnserialisableChars(value)) {
    return fail("The file contains characters that cannot be served as JSON");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return fail("The file must be valid JSON");
  }

  // The two formats differ at the top level, so they cannot share one check:
  // apple-app-site-association is a JSON object, while assetlinks.json is a
  // JSON array of statement objects. A bare string or number parses fine and is
  // never a valid association file either way.
  if (kind === "aasa") {
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return fail("apple-app-site-association must be a JSON object");
    }
    // Structural sanity only. Apple keeps adding keys, so this asks for one
    // recognised section rather than validating the whole document: a stricter
    // check would reject a valid file the day Apple ships a new format.
    const keys = Object.keys(parsed as Record<string, unknown>);
    if (!keys.some((key) => key === "applinks" || key === "webcredentials" || key === "appclips")) {
      return fail(
        "apple-app-site-association must contain at least one of 'applinks', 'webcredentials', or 'appclips'"
      );
    }
    return;
  }

  if (!Array.isArray(parsed)) {
    return fail("assetlinks.json must be a JSON array of statements");
  }
  if (
    !parsed.every((entry) => typeof entry === "object" && entry !== null && !Array.isArray(entry))
  ) {
    return fail("Every entry in assetlinks.json must be a JSON object");
  }
}

/**
 * PATCH body for a domain's deeplink configuration.
 *
 * Every field is optional and absence means "leave unchanged", so a partial
 * update is the normal case and an empty body is a no-op rather than a reset.
 * Explicit null clears a value; that distinction is the whole reason the
 * nullable fields are `.nullable().optional()` rather than one or the other.
 */
export const deeplinkConfigSchema = z.object({
  mode: z.enum(["shortener", "deeplink"]).optional(),
  appLinks: z
    .object({
      aasa: z
        .string()
        .superRefine((value, ctx) => refineAssociationFile(value, ctx, "aasa"))
        .nullable()
        .optional(),
      assetlinks: z
        .string()
        .superRefine((value, ctx) => refineAssociationFile(value, ctx, "assetlinks"))
        .nullable()
        .optional(),
    })
    .optional(),
  fallbackTarget: absoluteHttpUrl.nullable().optional(),
});

/** Optional `?domain=` filter. Accepts the primary domain as well as custom ones. */
export const domainQuerySchema = z.object({
  domain: hostnameSyntaxSchema.optional(),
});
