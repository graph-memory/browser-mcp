import { z } from "zod";
import { TOOLS } from "./registry.js";

/**
 * Generate an OpenAPI 3.1 document for the REST surface directly from the tool
 * registry. Request-body schemas come from each tool's zod shape via the native
 * `z.toJSONSchema` (draft-2020-12, which 3.1 aligns with). One source of truth:
 * a new tool shows up here automatically.
 *
 * Notes / known limits:
 *  - Cross-field `.refine` constraints (browser_cookies "url OR domain+path",
 *    browser_fill_form "exactly one of value/checked/options") don't serialize
 *    to JSON Schema — they're spelled out in each tool's `description` and
 *    enforced server-side (a violation returns HTTP 400).
 *  - Response `data` is a generic object in v1 (no per-tool output schemas).
 */

// Mirrors the package version. The release/version bump is handled separately.
const API_VERSION = "0.2.0";

type JsonObject = Record<string, unknown>;

const PROFILE_PARAM: JsonObject = {
  name: "profile",
  in: "query",
  required: false,
  description: "Which profile (shared live browser) to target. Defaults to 'default'.",
  schema: { type: "string", default: "default" },
};

function errorResponse(description: string): JsonObject {
  return {
    description,
    content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
  };
}

/** Convert a tool's zod raw shape to an OpenAPI-embeddable JSON Schema. */
function requestSchema(inputSchema: z.ZodRawShape): JsonObject {
  // io:"input" so defaulted/optional fields aren't marked required.
  const js = z.toJSONSchema(z.object(inputSchema), { io: "input" }) as JsonObject;
  // OpenAPI keeps schemas inline; the top-level $schema dialect marker is noise.
  delete js.$schema;
  return js;
}

export function buildOpenApiSpec(): JsonObject {
  const paths: JsonObject = {};

  for (const t of TOOLS) {
    paths[`/api/v1/tools/${t.name}`] = {
      post: {
        operationId: t.name,
        summary: t.description.split(/\.\s/)[0],
        description: t.description,
        parameters: [PROFILE_PARAM],
        requestBody: {
          required: false,
          content: { "application/json": { schema: requestSchema(t.inputSchema) } },
        },
        responses: {
          "200": {
            description:
              "The tool ran. `ok:true` with `data`/`content`, or `ok:false` for a tool-level " +
              "failure (e.g. a failed assertion or element not found) — both are HTTP 200.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ToolResponse" } } },
          },
          "400": errorResponse("Invalid arguments (zod validation) or invalid profile name."),
          "404": errorResponse("Unknown tool."),
          "503": errorResponse("Session cap reached."),
        },
      },
    };
  }

  paths["/api/v1/tools"] = {
    get: {
      operationId: "listTools",
      summary: "List available tools",
      responses: {
        "200": {
          description: "The tool catalogue (names + descriptions).",
          content: { "application/json": { schema: { type: "object" } } },
        },
      },
    },
  };

  paths["/api/v1/profiles/{profile}"] = {
    delete: {
      operationId: "releaseProfile",
      summary: "Release a profile holder (close its browser if no MCP session holds it)",
      parameters: [{ name: "profile", in: "path", required: true, schema: { type: "string" } }],
      responses: {
        "200": {
          description: "Released ({ ok:true, released:boolean }).",
          content: { "application/json": { schema: { type: "object" } } },
        },
      },
    },
  };

  return {
    openapi: "3.1.0",
    info: {
      title: "browser-mcp REST API",
      version: API_VERSION,
      description:
        "Stateless REST/JSON surface over the same live browser as the MCP server. " +
        "Each call is an independent POST; `?profile=` selects the shared browser to drive " +
        "(the same profile an MCP agent uses). Pass an explicit `tab_id` to target a specific tab.",
    },
    servers: [{ url: "/" }],
    security: [{ bearerAuth: [] }],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description: "Required only when the server is started with an API key (BROWSER_MCP_API_KEY).",
        },
      },
      schemas: {
        ToolResponse: {
          type: "object",
          required: ["ok"],
          properties: {
            ok: { type: "boolean", description: "false for a tool-level failure (still HTTP 200)." },
            data: { description: "Structured result (shape depends on the tool); absent for some action-only tools." },
            content: {
              type: "array",
              description: "Human/LLM-formatted blocks (text, or base64 image for screenshots), kept for parity with MCP.",
              items: { type: "object" },
            },
            error: {
              type: "object",
              properties: { message: { type: "string" }, issues: {} },
            },
          },
        },
        Error: {
          type: "object",
          required: ["ok", "error"],
          properties: {
            ok: { type: "boolean", const: false },
            error: {
              type: "object",
              required: ["message"],
              properties: { message: { type: "string" }, issues: {} },
            },
          },
        },
      },
    },
  };
}
