/**
 * Render model for the hmd.bio API reference at /docs.
 *
 * `src/lib/openapi.ts` is the hand-maintained source of truth and uses `$ref`
 * throughout. Anything that needs to *render* the spec (the docs page, and any
 * future plain-text or LLM-facing export) needs the same three things: a `$ref`
 * resolver, an `allOf` merger, and a way to derive a plausible example value
 * from a schema. Those live here once so there is never a second copy.
 *
 * Everything in this module is pure and server-safe: it takes the spec object
 * and returns plain data, so a server component can do the work and ship only
 * the rendered strings to the browser.
 */

import { openApiSpec } from "@/lib/openapi";

/* -------------------------------------------------------------------------- */
/* Spec types (the subset this codebase actually uses)                         */
/* -------------------------------------------------------------------------- */

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface OpenApiRef {
  $ref: string;
}

export interface OpenApiSchema {
  $ref?: string;
  type?: string;
  format?: string;
  description?: string;
  enum?: JsonValue[];
  default?: JsonValue;
  example?: JsonValue;
  nullable?: boolean;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  pattern?: string;
  required?: string[];
  properties?: Record<string, OpenApiSchema>;
  items?: OpenApiSchema;
  allOf?: OpenApiSchema[];
  oneOf?: OpenApiSchema[];
  anyOf?: OpenApiSchema[];
  additionalProperties?: boolean | OpenApiSchema;
}

export interface OpenApiMediaType {
  schema?: OpenApiSchema;
  example?: JsonValue;
}

export interface OpenApiParameter {
  $ref?: string;
  name?: string;
  in?: "query" | "path" | "header" | "cookie";
  required?: boolean;
  description?: string;
  schema?: OpenApiSchema;
  example?: JsonValue;
}

export interface OpenApiRequestBody {
  required?: boolean;
  description?: string;
  content?: Record<string, OpenApiMediaType>;
}

export interface OpenApiResponse {
  $ref?: string;
  description?: string;
  content?: Record<string, OpenApiMediaType>;
}

export interface OpenApiOperation {
  tags?: string[];
  summary?: string;
  description?: string;
  operationId?: string;
  security?: Array<Record<string, string[]>>;
  parameters?: OpenApiParameter[];
  requestBody?: OpenApiRequestBody;
  responses?: Record<string, OpenApiResponse>;
}

export interface OpenApiTag {
  name: string;
  description?: string;
}

export interface OpenApiDocument {
  openapi: string;
  info: { title: string; version: string; description?: string };
  servers?: Array<{ url: string; description?: string }>;
  tags?: OpenApiTag[];
  paths: Record<string, Record<string, OpenApiOperation>>;
  components?: {
    parameters?: Record<string, OpenApiParameter>;
    responses?: Record<string, OpenApiResponse>;
    schemas?: Record<string, OpenApiSchema>;
    securitySchemes?: Record<string, { description?: string }>;
  };
}

/**
 * The spec is written as a plain object literal, so TypeScript infers a huge
 * structural type that cannot be indexed generically. One cast at the boundary
 * buys full typing for every consumer below.
 */
export const spec = openApiSpec as unknown as OpenApiDocument;

export const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

/* -------------------------------------------------------------------------- */
/* $ref resolution                                                             */
/* -------------------------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Resolves a local JSON pointer such as `#/components/schemas/Link` against the
 * document. Only local refs are supported: the spec has no external ones, and
 * silently following a remote pointer would be worse than failing.
 */
export function resolveRef<T>(doc: OpenApiDocument, ref: string): T | undefined {
  if (!ref.startsWith("#/")) return undefined;

  let current: unknown = doc;
  for (const rawSegment of ref.slice(2).split("/")) {
    const segment = rawSegment.replace(/~1/g, "/").replace(/~0/g, "~");
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }
  return current as T | undefined;
}

/** Follows a `$ref` chain to the concrete node, guarding against a ref cycle. */
function deref<T extends { $ref?: string }>(
  doc: OpenApiDocument,
  node: T | undefined
): T | undefined {
  let current = node;
  const seen = new Set<string>();

  while (current?.$ref) {
    if (seen.has(current.$ref)) return undefined;
    seen.add(current.$ref);
    current = resolveRef<T>(doc, current.$ref);
  }
  return current;
}

/**
 * Flattens a schema into a single object: follows `$ref`, merges every `allOf`
 * branch, and collapses `oneOf`/`anyOf` to their first branch, which is the
 * shape a reader wants to see first. `depth` bounds a self-referential schema.
 */
export function flattenSchema(
  doc: OpenApiDocument,
  schema: OpenApiSchema | undefined,
  depth = 0
): OpenApiSchema | undefined {
  if (!schema || depth > 12) return undefined;

  const resolved = deref(doc, schema);
  if (!resolved) return undefined;

  const branches = resolved.allOf ?? resolved.oneOf?.slice(0, 1) ?? resolved.anyOf?.slice(0, 1);
  if (!branches?.length) return resolved;

  const merged: OpenApiSchema = { ...resolved };
  delete merged.allOf;
  delete merged.oneOf;
  delete merged.anyOf;

  // A later branch refines an earlier one, so it has to win: the envelope
  // declares `data` as an empty schema and the second branch gives it a shape.
  // The parent's own properties, if it has any beside the allOf, win outright.
  const ownProperties = merged.properties ?? {};
  let branchProperties: Record<string, OpenApiSchema> = {};

  for (const branch of branches) {
    const flat = flattenSchema(doc, branch, depth + 1);
    if (!flat) continue;

    merged.type = merged.type ?? flat.type;
    merged.format = merged.format ?? flat.format;
    merged.description = merged.description ?? flat.description;
    merged.items = merged.items ?? flat.items;
    branchProperties = { ...branchProperties, ...flat.properties };
    merged.required = [...new Set([...(flat.required ?? []), ...(merged.required ?? [])])];
  }

  merged.properties = { ...branchProperties, ...ownProperties };

  if (!merged.required?.length) delete merged.required;
  if (merged.properties && Object.keys(merged.properties).length === 0) delete merged.properties;

  return merged;
}

/* -------------------------------------------------------------------------- */
/* Example derivation                                                          */
/* -------------------------------------------------------------------------- */

const PLACEHOLDERS: Record<string, string> = {
  uri: "https://example.com/some/long/path",
  url: "https://example.com/some/long/path",
  "date-time": "2026-01-01T00:00:00.000Z",
  date: "2026-01-01",
  email: "you@example.com",
  password: "your-password",
  hostname: "links.example.com",
};

/**
 * Derives a representative value for a schema, preferring an author-supplied
 * `example` or `default` before falling back to a format-aware placeholder.
 */
export function exampleFromSchema(
  doc: OpenApiDocument,
  schema: OpenApiSchema | undefined,
  depth = 0
): JsonValue {
  const flat = flattenSchema(doc, schema, depth);
  if (!flat || depth > 8) return null;

  if (flat.example !== undefined) return flat.example;
  if (flat.default !== undefined) return flat.default;
  if (flat.enum?.length) return flat.enum[0];

  switch (flat.type) {
    case "object": {
      const out: Record<string, JsonValue> = {};
      for (const [name, child] of Object.entries(flat.properties ?? {})) {
        out[name] = exampleFromSchema(doc, child, depth + 1);
      }
      return out;
    }
    case "array":
      return [exampleFromSchema(doc, flat.items, depth + 1)];
    case "integer":
    case "number":
      return flat.minimum ?? 1;
    case "boolean":
      return true;
    case "string":
      return (flat.format && PLACEHOLDERS[flat.format]) ?? "string";
    default:
      return flat.properties ? exampleFromSchema(doc, { ...flat, type: "object" }, depth) : null;
  }
}

/* -------------------------------------------------------------------------- */
/* Render model                                                                */
/* -------------------------------------------------------------------------- */

/** One row of a rendered schema table, with its nested properties inline. */
export interface SchemaField {
  name: string;
  typeLabel: string;
  required: boolean;
  description?: string;
  enumValues?: string[];
  defaultValue?: string;
  constraints: string[];
  children: SchemaField[];
}

export interface ParameterView {
  name: string;
  location: "query" | "path" | "header" | "cookie";
  required: boolean;
  description?: string;
  typeLabel: string;
  enumValues?: string[];
  defaultValue?: string;
  constraints: string[];
}

export interface ResponseView {
  status: string;
  description: string;
  mediaType?: string;
  fields: SchemaField[];
  example?: string;
}

export interface CodeSample {
  language: "curl" | "javascript" | "python";
  label: string;
  code: string;
}

/** The minimal shape the client-side playground needs, so nothing else ships. */
export interface PlaygroundSpec {
  method: string;
  path: string;
  pathParams: Array<{ name: string; placeholder: string }>;
  queryParams: Array<{ name: string; placeholder: string; required: boolean }>;
  body?: string;
  mutating: boolean;
  requiresAuth: boolean;
}

export interface OperationView {
  id: string;
  method: HttpMethod;
  methodLabel: string;
  path: string;
  tag: string;
  summary: string;
  description?: string;
  authLabel: string;
  parameters: ParameterView[];
  requestBody?: {
    required: boolean;
    description?: string;
    fields: SchemaField[];
    example?: string;
  };
  responses: ResponseView[];
  samples: CodeSample[];
  playground: PlaygroundSpec;
}

export interface TagGroup {
  name: string;
  description?: string;
  operations: OperationView[];
}

/** Everything the left-hand nav and the Cmd-K search need, and nothing more. */
export interface SearchEntry {
  id: string;
  method: string;
  path: string;
  summary: string;
  tag: string;
}

export const BASE_URL = spec.servers?.[0]?.url ?? "https://hmd.bio";

/** Stable, human-readable anchor: `post-api-v1-links-keyword`. */
export function operationId(method: string, path: string): string {
  const slug = path
    .replace(/[{}]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return `${method.toLowerCase()}-${slug}`;
}

function typeLabel(doc: OpenApiDocument, schema: OpenApiSchema | undefined): string {
  const flat = flattenSchema(doc, schema);
  if (!flat) return "any";

  if (flat.type === "array") {
    const inner = flattenSchema(doc, flat.items);
    return `array of ${inner?.type ?? "any"}`;
  }
  if (flat.format) return `${flat.type ?? "string"} (${flat.format})`;
  if (!flat.type && flat.properties) return "object";
  return flat.type ?? "any";
}

function constraintsOf(schema: OpenApiSchema): string[] {
  const out: string[] = [];
  if (schema.minimum !== undefined) out.push(`min ${schema.minimum}`);
  if (schema.maximum !== undefined) out.push(`max ${schema.maximum}`);
  if (schema.minLength !== undefined) out.push(`min length ${schema.minLength}`);
  if (schema.maxLength !== undefined) out.push(`max length ${schema.maxLength}`);
  if (schema.minItems !== undefined) out.push(`min items ${schema.minItems}`);
  if (schema.maxItems !== undefined) out.push(`max items ${schema.maxItems}`);
  if (schema.pattern) out.push(`pattern ${schema.pattern}`);
  if (schema.nullable) out.push("nullable");
  return out;
}

function scalar(value: JsonValue | undefined): string | undefined {
  if (value === undefined || value === null) return undefined;
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

/** Expands an object schema into a flat-but-nested field list for rendering. */
function fieldsOf(
  doc: OpenApiDocument,
  schema: OpenApiSchema | undefined,
  depth = 0
): SchemaField[] {
  const flat = flattenSchema(doc, schema, depth);
  if (!flat || depth > 5) return [];

  // An array of objects reads best as the item's own fields.
  if (flat.type === "array") return fieldsOf(doc, flat.items, depth + 1);
  if (!flat.properties) return [];

  const required = new Set(flat.required ?? []);

  return Object.entries(flat.properties).map(([name, raw]) => {
    const child = flattenSchema(doc, raw, depth + 1) ?? {};
    return {
      name,
      typeLabel: typeLabel(doc, raw),
      required: required.has(name),
      description: child.description,
      enumValues: child.enum?.map((value) => String(value)),
      defaultValue: scalar(child.default),
      constraints: constraintsOf(child),
      children: fieldsOf(doc, child, depth + 1),
    };
  });
}

function parametersOf(doc: OpenApiDocument, operation: OpenApiOperation): ParameterView[] {
  return (operation.parameters ?? [])
    .map((raw) => deref(doc, raw))
    .filter((param): param is OpenApiParameter => Boolean(param?.name))
    .map((param) => {
      const schema = flattenSchema(doc, param.schema) ?? {};
      return {
        name: param.name as string,
        location: param.in ?? "query",
        required: param.required ?? param.in === "path",
        description: param.description,
        typeLabel: typeLabel(doc, param.schema),
        enumValues: schema.enum?.map((value) => String(value)),
        defaultValue: scalar(schema.default),
        constraints: constraintsOf(schema),
      };
    });
}

function pickMediaType(
  content: Record<string, OpenApiMediaType> | undefined
): [string, OpenApiMediaType] | undefined {
  if (!content) return undefined;
  const entries = Object.entries(content);
  const json = entries.find(([type]) => type.includes("json"));
  return json ?? entries[0];
}

function pretty(value: JsonValue | undefined): string | undefined {
  if (value === undefined || value === null) return undefined;
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

/**
 * Every response is wrapped in the shared success or error envelope, whose
 * `success` and `statusCode` are derived rather than declared per response.
 * Filling them from the response's own status stops a derived example claiming
 * `"statusCode": 1`.
 */
function alignEnvelope(example: JsonValue, status: string): JsonValue {
  const code = Number(status);
  if (!Number.isFinite(code) || !isRecord(example)) return example;

  const out = { ...example } as Record<string, JsonValue>;
  if ("statusCode" in out) out.statusCode = code;
  if ("success" in out) out.success = code < 400;
  return out;
}

function responsesOf(doc: OpenApiDocument, operation: OpenApiOperation): ResponseView[] {
  return Object.entries(operation.responses ?? {})
    .map(([status, raw]) => {
      const response = deref(doc, raw);
      const media = pickMediaType(response?.content);
      const example =
        media?.[1].example ?? alignEnvelope(exampleFromSchema(doc, media?.[1].schema), status);

      return {
        status,
        description: response?.description ?? "",
        mediaType: media?.[0],
        fields: fieldsOf(doc, media?.[1].schema),
        example: pretty(example),
      };
    })
    .sort((a, b) => a.status.localeCompare(b.status));
}

function authLabelOf(operation: OpenApiOperation): string {
  const security = operation.security;
  if (!security || security.length === 0) return "No authentication";

  const schemes = new Set(security.flatMap((entry) => Object.keys(entry)));
  const hasBearer = schemes.has("BearerAuth");
  const hasSession = schemes.has("session");

  if (hasBearer && hasSession) return "API key or session";
  if (hasBearer) return "API key";
  if (hasSession) return "Session only";
  return "Authenticated";
}

/* -------------------------------------------------------------------------- */
/* Code samples                                                                */
/* -------------------------------------------------------------------------- */

const AUTH_HEADER_VALUE = "Bearer hmd_yourkey";

/** Builds an example URL with path placeholders and required query params filled in. */
function sampleUrl(path: string, parameters: ParameterView[]): string {
  let url = path;
  for (const param of parameters.filter((p) => p.location === "path")) {
    url = url.replace(`{${param.name}}`, placeholderFor(param));
  }

  const query = parameters
    .filter((p) => p.location === "query" && p.required)
    .map((p) => `${p.name}=${encodeURIComponent(placeholderFor(p))}`);

  return `${BASE_URL}${url}${query.length ? `?${query.join("&")}` : ""}`;
}

function placeholderFor(param: ParameterView): string {
  if (param.defaultValue) return param.defaultValue;
  if (param.enumValues?.length) return param.enumValues[0];
  if (param.name === "keyword") return "my-link";
  if (param.name === "hostname") return "links.example.com";
  if (param.name === "id") return "65f0c2a1b3d4e5f6a7b8c9d0";
  if (param.typeLabel.startsWith("integer") || param.typeLabel.startsWith("number")) return "1";
  return "value";
}

function buildSamples(
  method: HttpMethod,
  path: string,
  parameters: ParameterView[],
  body: string | undefined,
  needsAuth: boolean
): CodeSample[] {
  const url = sampleUrl(path, parameters);
  const upper = method.toUpperCase();

  // curl defaults to GET, so spelling it out would just be noise.
  const curlLines = [upper === "GET" ? `curl "${url}"` : `curl -X ${upper} "${url}"`];
  if (needsAuth) curlLines.push(`  -H "Authorization: ${AUTH_HEADER_VALUE}"`);
  if (body) {
    curlLines.push(`  -H "Content-Type: application/json"`);
    curlLines.push(`  -d '${body.replace(/\n\s*/g, " ")}'`);
  }

  const jsHeaders: string[] = [];
  if (needsAuth) jsHeaders.push(`    Authorization: "${AUTH_HEADER_VALUE}",`);
  if (body) jsHeaders.push(`    "Content-Type": "application/json",`);

  const jsLines = [
    `const response = await fetch("${url}", {`,
    `  method: "${upper}",`,
    ...(jsHeaders.length ? [`  headers: {`, ...jsHeaders, `  },`] : []),
    ...(body ? [`  body: JSON.stringify(${indentJson(body, "  ")}),`] : []),
    `});`,
    ``,
    `const data = await response.json();`,
    `console.log(data);`,
  ];

  const pyHeaders: string[] = [];
  if (needsAuth) pyHeaders.push(`    "Authorization": "${AUTH_HEADER_VALUE}",`);
  if (body) pyHeaders.push(`    "Content-Type": "application/json",`);

  const pyLines = [
    `import requests`,
    ``,
    `response = requests.${method}(`,
    `    "${url}",`,
    ...(pyHeaders.length ? [`    headers={`, ...pyHeaders.map((h) => `    ${h}`), `    },`] : []),
    ...(body ? [`    json=${toPython(body)},`] : []),
    `)`,
    ``,
    `print(response.status_code, response.json())`,
  ];

  return [
    { language: "curl", label: "curl", code: curlLines.join(" \\\n") },
    { language: "javascript", label: "JavaScript", code: jsLines.join("\n") },
    { language: "python", label: "Python", code: pyLines.join("\n") },
  ];
}

/** Re-indents a pretty-printed JSON block so it sits correctly inside a call. */
function indentJson(json: string, indent: string): string {
  return json
    .split("\n")
    .map((line, index) => (index === 0 ? line : `${indent}${line}`))
    .join("\n");
}

/** Converts a JSON literal to its Python equivalent for the requests sample. */
function toPython(json: string): string {
  const indented = indentJson(json, "    ");
  return indented
    .replace(/\btrue\b/g, "True")
    .replace(/\bfalse\b/g, "False")
    .replace(/\bnull\b/g, "None");
}

/* -------------------------------------------------------------------------- */
/* Public builder                                                              */
/* -------------------------------------------------------------------------- */

function buildOperation(
  doc: OpenApiDocument,
  method: HttpMethod,
  path: string,
  operation: OpenApiOperation
): OperationView {
  const parameters = parametersOf(doc, operation);
  const authLabel = authLabelOf(operation);
  const needsAuth = authLabel !== "No authentication";

  const bodyMedia = pickMediaType(operation.requestBody?.content);
  const bodySchema = bodyMedia?.[1].schema;
  const bodyExample = bodyMedia ? (bodyMedia[1].example ?? exampleFromSchema(doc, bodySchema)) : undefined;
  const bodyString = pretty(bodyExample);

  return {
    id: operationId(method, path),
    method,
    methodLabel: method.toUpperCase(),
    path,
    tag: operation.tags?.[0] ?? "Other",
    summary: operation.summary ?? `${method.toUpperCase()} ${path}`,
    description: operation.description,
    authLabel,
    parameters,
    requestBody: operation.requestBody
      ? {
          required: operation.requestBody.required ?? false,
          description: operation.requestBody.description,
          fields: fieldsOf(doc, bodySchema),
          example: bodyString,
        }
      : undefined,
    responses: responsesOf(doc, operation),
    samples: buildSamples(method, path, parameters, bodyString, needsAuth),
    playground: {
      method: method.toUpperCase(),
      path,
      pathParams: parameters
        .filter((p) => p.location === "path")
        .map((p) => ({ name: p.name, placeholder: placeholderFor(p) })),
      queryParams: parameters
        .filter((p) => p.location === "query")
        .map((p) => ({ name: p.name, placeholder: placeholderFor(p), required: p.required })),
      body: bodyString,
      mutating: method !== "get",
      requiresAuth: needsAuth,
    },
  };
}

/** Groups every documented operation by its first tag, in the spec's tag order. */
export function buildTagGroups(doc: OpenApiDocument = spec): TagGroup[] {
  const byTag = new Map<string, OperationView[]>();

  for (const [path, pathItem] of Object.entries(doc.paths)) {
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (!operation) continue;

      const view = buildOperation(doc, method, path, operation);
      const bucket = byTag.get(view.tag);
      if (bucket) bucket.push(view);
      else byTag.set(view.tag, [view]);
    }
  }

  const ordered = (doc.tags ?? []).map((tag) => ({
    name: tag.name,
    description: tag.description,
    operations: byTag.get(tag.name) ?? [],
  }));

  // Anything tagged outside the declared list still has to appear somewhere.
  for (const [name, operations] of byTag) {
    if (!ordered.some((group) => group.name === name)) {
      ordered.push({ name, description: undefined, operations });
    }
  }

  return ordered.filter((group) => group.operations.length > 0);
}

/** The small index the Cmd-K palette filters over. */
export function buildSearchIndex(groups: TagGroup[]): SearchEntry[] {
  return groups.flatMap((group) =>
    group.operations.map((operation) => ({
      id: operation.id,
      method: operation.methodLabel,
      path: operation.path,
      summary: operation.summary,
      tag: group.name,
    }))
  );
}
