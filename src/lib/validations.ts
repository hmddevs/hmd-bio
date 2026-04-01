import { z } from "zod";

export const shortenSchema = z.object({
  url: z.string().url("Invalid URL"),
  keyword: z
    .string()
    .regex(/^[a-zA-Z0-9_-]*$/, "Only alphanumeric, hyphens, and underscores allowed")
    .max(100)
    .optional(),
  title: z.string().max(500).optional(),
  turnstileToken: z.string().optional(),
});

export const editLinkSchema = z.object({
  url: z.string().url("Invalid URL").optional(),
  title: z.string().max(500).optional(),
  keyword: z
    .string()
    .regex(/^[a-zA-Z0-9_-]+$/)
    .max(100)
    .optional(),
  statusCode: z.enum(["301", "302"]).optional(),
  isPasswordProtected: z.boolean().optional(),
  password: z.string().min(1).max(200).optional(),
  expiresAt: z.string().datetime().nullable().optional(),
  ogTitle: z.string().max(200).nullable().optional(),
  ogDescription: z.string().max(500).nullable().optional(),
  ogImage: z.string().url().nullable().optional(),
});

export const linksQuerySchema = z.object({
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

export const bulkImportSchema = z.array(
  z.object({
    url: z.string().url(),
    keyword: z
      .string()
      .regex(/^[a-zA-Z0-9_-]*$/)
      .max(100)
      .optional(),
    title: z.string().max(500).optional(),
  })
);

export const apiKeySchema = z.object({
  label: z.string().min(1).max(100).default("Default"),
});
