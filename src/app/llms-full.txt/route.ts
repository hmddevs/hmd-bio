import { openApiSpec } from "@/lib/openapi";

/**
 * Serves the entire OpenAPI spec as a single self-contained markdown document
 * at /llms-full.txt, generated at request time from `openApiSpec` (see
 * src/lib/openapi.ts) so it can never drift out of sync with it. All $ref
 * pointers are resolved inline — an LLM fetching this one file never needs to
 * follow a second request to understand a schema.
 *
 * Kept a hand-written serialiser rather than a dependency: the source spec is
 * a plain object authored by hand, not third-party input, so a small
 * type-safe walk over its known shape is simpler and safer than pulling in a
 * general-purpose OpenAPI toolchain for one route.
 */

// --- Minimal typed view of the spec's shape --------------------------------
// Covers only the fields actually used across openApiSpec; not a general
// OpenAPI 3 type definition.

interface RefObject {
  $ref: string;
}

interface SchemaObject {
  type?: string;
  format?: string;
  description?: string;
  enum?: readonly (string | number)[];
  properties?: Record<string, SchemaObject | RefObject>;
  items?: SchemaObject | RefObject;
  required?: readonly string[];
  nullable?: boolean;
  allOf?: (SchemaObject | RefObject)[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  default?: unknown;
  example?: unknown;
  $ref?: string;
}

interface ParameterObject {
  name: string;
  in: string;
  required?: boolean;
  schema?: SchemaObject | RefObject;
  description?: string;
  $ref?: string;
}

interface MediaTypeObject {
  schema?: SchemaObject | RefObject;
  example?: unknown;
}

interface RequestBodyObject {
  required?: boolean;
  content: Record<string, MediaTypeObject>;
}

interface ResponseObject {
  description: string;
  content?: Record<string, MediaTypeObject>;
  $ref?: string;
}

interface OperationObject {
  tags?: string[];
  summary?: string;
  description?: string;
  security?: Record<string, unknown[]>[];
  parameters?: (ParameterObject | RefObject)[];
  requestBody?: RequestBodyObject;
  responses: Record<string, ResponseObject | RefObject>;
}

type PathItemObject = Partial<Record<"get" | "post" | "put" | "patch" | "delete", OperationObject>>;

interface SecuritySchemeObject {
  type: string;
  in?: string;
  name?: string;
  scheme?: string;
  bearerFormat?: string;
  description?: string;
}

interface OpenApiDocument {
  openapi: string;
  info: { title: string; version: string; description: string; contact?: { name: string; url: string } };
  servers: { url: string; description: string }[];
  tags: { name: string; description: string }[];
  paths: Record<string, PathItemObject>;
  components: {
    parameters: Record<string, ParameterObject>;
    responses: Record<string, ResponseObject>;
    schemas: Record<string, SchemaObject>;
    securitySchemes: Record<string, SecuritySchemeObject>;
  };
}

// The literal object in src/lib/openapi.ts is hand-authored and structurally
// matches the shape above; this is the one place that assumption is made.
const spec = openApiSpec as unknown as OpenApiDocument;

// --- $ref resolution ---------------------------------------------------

function isRef(node: object): node is RefObject {
  return typeof (node as RefObject).$ref === "string";
}

function resolveRef<T>(ref: string): T {
  const segments = ref.replace(/^#\//, "").split("/");
  let node: unknown = spec;
  for (const segment of segments) {
    if (node === undefined || node === null) {
      throw new Error(`Could not resolve $ref "${ref}": missing segment "${segment}"`);
    }
    node = (node as Record<string, unknown>)[segment];
  }
  return node as T;
}

function resolveSchema(node: SchemaObject | RefObject): SchemaObject {
  return isRef(node) ? resolveSchema(resolveRef<SchemaObject>(node.$ref)) : node;
}

function resolveParameter(node: ParameterObject | RefObject): ParameterObject {
  return isRef(node) ? resolveRef<ParameterObject>(node.$ref) : node;
}

function resolveResponse(node: ResponseObject | RefObject): ResponseObject {
  return isRef(node) ? resolveRef<ResponseObject>(node.$ref) : node;
}

// --- Markdown rendering --------------------------------------------------

const MAX_SCHEMA_DEPTH = 8;

function schemaTypeLabel(schema: SchemaObject): string {
  if (schema.enum) return `enum(${schema.enum.map((v) => JSON.stringify(v)).join(" | ")})`;
  if (schema.type === "array") return "array";
  return schema.type ?? "object";
}

function schemaConstraints(schema: SchemaObject): string[] {
  const parts: string[] = [];
  if (schema.format) parts.push(`format=${schema.format}`);
  if (schema.pattern) parts.push(`pattern=${schema.pattern}`);
  if (schema.minLength !== undefined) parts.push(`minLength=${schema.minLength}`);
  if (schema.maxLength !== undefined) parts.push(`maxLength=${schema.maxLength}`);
  if (schema.minimum !== undefined) parts.push(`minimum=${schema.minimum}`);
  if (schema.maximum !== undefined) parts.push(`maximum=${schema.maximum}`);
  if (schema.default !== undefined) parts.push(`default=${JSON.stringify(schema.default)}`);
  if (schema.nullable) parts.push("nullable");
  return parts;
}

/**
 * Renders a schema as a nested markdown bullet list. `allOf` is flattened
 * into a single merged property set (the spec only uses `allOf` for the
 * success-envelope-plus-data pattern and a couple of response-shape mixins,
 * never for genuine polymorphism), so the output stays readable rather than
 * mirroring the compositional structure literally.
 */
function renderSchema(node: SchemaObject | RefObject, depth: number): string[] {
  if (depth > MAX_SCHEMA_DEPTH) return [`${"  ".repeat(depth)}- (schema nested too deep, truncated)`];

  const indent = "  ".repeat(depth);
  const lines: string[] = [];
  const schema = resolveSchema(node);

  if (schema.allOf) {
    const merged: Record<string, SchemaObject | RefObject> = {};
    const requiredNames = new Set<string>();
    for (const member of schema.allOf) {
      const resolvedMember = resolveSchema(member);
      if (resolvedMember.properties) Object.assign(merged, resolvedMember.properties);
      for (const name of resolvedMember.required ?? []) requiredNames.add(name);
    }
    for (const [name, propSchema] of Object.entries(merged)) {
      lines.push(...renderProperty(name, propSchema, requiredNames.has(name), depth));
    }
    return lines;
  }

  if (schema.type === "array" && schema.items) {
    lines.push(`${indent}- array of:`);
    lines.push(...renderSchema(schema.items, depth + 1));
    return lines;
  }

  if (schema.properties) {
    const required = new Set(schema.required ?? []);
    for (const [name, propSchema] of Object.entries(schema.properties)) {
      lines.push(...renderProperty(name, propSchema, required.has(name), depth));
    }
    return lines;
  }

  const constraints = schemaConstraints(schema);
  const suffix = constraints.length ? ` (${constraints.join(", ")})` : "";
  lines.push(`${indent}- type: ${schemaTypeLabel(schema)}${suffix}`);
  if (schema.description) lines.push(`${indent}  ${schema.description}`);
  return lines;
}

function renderProperty(
  name: string,
  node: SchemaObject | RefObject,
  required: boolean,
  depth: number
): string[] {
  const indent = "  ".repeat(depth);
  const schema = resolveSchema(node);
  const constraints = schemaConstraints(schema);
  const requiredLabel = required ? ", required" : "";
  const constraintLabel = constraints.length ? `, ${constraints.join(", ")}` : "";
  const description = schema.description ? `: ${schema.description}` : "";

  const lines = [`${indent}- **${name}** (${schemaTypeLabel(schema)}${requiredLabel}${constraintLabel})${description}`];

  if (schema.type === "array" && schema.items) {
    const itemSchema = resolveSchema(schema.items);
    if (itemSchema.properties || itemSchema.allOf) {
      lines.push(`${indent}  items:`);
      lines.push(...renderSchema(schema.items, depth + 2));
    }
  } else if (schema.properties || schema.allOf) {
    lines.push(...renderSchema(schema, depth + 1));
  }

  return lines;
}

function renderRequestBody(requestBody: RequestBodyObject): string[] {
  const lines: string[] = [`- **Request body**${requestBody.required ? " (required)" : ""}:`];
  for (const [mediaType, media] of Object.entries(requestBody.content)) {
    lines.push(`  - Content-Type: \`${mediaType}\``);
    if (media.schema) lines.push(...renderSchema(media.schema, 2));
    if (media.example !== undefined) {
      lines.push("  - Example:");
      lines.push("    ```json");
      lines.push(
        JSON.stringify(media.example, null, 2)
          .split("\n")
          .map((l) => `    ${l}`)
          .join("\n")
      );
      lines.push("    ```");
    }
  }
  return lines;
}

function renderResponses(responses: Record<string, ResponseObject | RefObject>): string[] {
  const lines: string[] = ["- **Responses**:"];
  for (const [status, node] of Object.entries(responses)) {
    const response = resolveResponse(node);
    lines.push(`  - \`${status}\` — ${response.description}`);
    if (response.content) {
      for (const [mediaType, media] of Object.entries(response.content)) {
        if (!media.schema) continue;
        lines.push(`    - Content-Type: \`${mediaType}\``);
        lines.push(...renderSchema(media.schema, 3));
      }
    }
  }
  return lines;
}

function renderSecurity(operation: OperationObject): string {
  if (!operation.security || operation.security.length === 0) {
    return "No authentication required";
  }
  const schemeNames = operation.security.map((requirement) => Object.keys(requirement)[0]);
  return `One of: ${schemeNames.join(" or ")}`;
}

function renderOperation(method: string, path: string, operation: OperationObject): string[] {
  const lines: string[] = [];
  lines.push(`### ${method.toUpperCase()} ${path}`);
  if (operation.summary) lines.push("");
  if (operation.summary) lines.push(`**${operation.summary}**`);
  if (operation.description) lines.push(operation.description);
  lines.push("");
  lines.push(`- **Auth**: ${renderSecurity(operation)}`);

  if (operation.parameters && operation.parameters.length > 0) {
    lines.push("- **Parameters**:");
    for (const paramNode of operation.parameters) {
      const param = resolveParameter(paramNode);
      const schema = param.schema ? resolveSchema(param.schema) : undefined;
      const type = schema ? schemaTypeLabel(schema) : "string";
      const constraints = schema ? schemaConstraints(schema) : [];
      const constraintLabel = constraints.length ? `, ${constraints.join(", ")}` : "";
      const requiredLabel = param.required ? ", required" : ", optional";
      lines.push(
        `  - \`${param.name}\` (${param.in}, ${type}${requiredLabel}${constraintLabel})` +
          (param.description ? `: ${param.description}` : "")
      );
    }
  }

  if (operation.requestBody) {
    lines.push(...renderRequestBody(operation.requestBody));
  }

  lines.push(...renderResponses(operation.responses));
  lines.push("");
  return lines;
}

const METHOD_ORDER = ["get", "post", "put", "patch", "delete"] as const;

function generateMarkdown(): string {
  const lines: string[] = [];

  lines.push(`# ${spec.info.title}`);
  lines.push("");
  lines.push(spec.info.description);
  lines.push("");
  lines.push(`Version: ${spec.info.version}`);
  lines.push("");
  lines.push("## Base URL");
  lines.push("");
  for (const server of spec.servers) {
    lines.push(`- \`${server.url}\` — ${server.description}`);
  }
  lines.push("");

  lines.push("## Authentication");
  lines.push("");
  for (const [name, scheme] of Object.entries(spec.components.securitySchemes)) {
    const detail =
      scheme.type === "apiKey"
        ? `apiKey, in ${scheme.in}, name \`${scheme.name}\``
        : `${scheme.type}${scheme.scheme ? ` (${scheme.scheme})` : ""}${scheme.bearerFormat ? `, format \`${scheme.bearerFormat}\`` : ""}`;
    lines.push(`### ${name}`);
    lines.push(`${detail}`);
    if (scheme.description) lines.push(scheme.description);
    lines.push("");
  }

  lines.push("## Rate limits");
  lines.push("");
  lines.push(resolveResponse({ $ref: "#/components/responses/RateLimited" }).description);
  lines.push("");

  lines.push("## Endpoints");
  lines.push("");

  for (const tag of spec.tags) {
    const operationsForTag: { method: string; path: string; operation: OperationObject }[] = [];
    for (const [path, pathItem] of Object.entries(spec.paths)) {
      for (const method of METHOD_ORDER) {
        const operation = pathItem[method];
        if (operation && operation.tags?.includes(tag.name)) {
          operationsForTag.push({ method, path, operation });
        }
      }
    }
    if (operationsForTag.length === 0) continue;

    lines.push(`## ${tag.name}`);
    lines.push("");
    lines.push(tag.description);
    lines.push("");
    for (const { method, path, operation } of operationsForTag) {
      lines.push(...renderOperation(method, path, operation));
    }
  }

  return lines.join("\n");
}

// Regenerated at most once an hour; the spec only changes on deploy, so this
// keeps the response fast without ever serving genuinely stale content for
// more than the revalidation window.
export const revalidate = 3600;

export function GET() {
  const body = generateMarkdown();
  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
