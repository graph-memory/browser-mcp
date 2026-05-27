import { describe, it, expect } from "vitest";
import { buildOpenApiSpec } from "../../src/openapi.js";
import { TOOLS } from "../../src/registry.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const spec = buildOpenApiSpec() as any;

describe("OpenAPI spec", () => {
  it("is OpenAPI 3.1 and JSON-serializable", () => {
    expect(spec.openapi).toBe("3.1.0");
    expect(spec.info.title).toContain("browser-mcp");
    expect(() => JSON.stringify(spec)).not.toThrow();
  });

  it("has a POST path with a (dialect-stripped) requestBody object schema for every tool", () => {
    for (const t of TOOLS) {
      const p = spec.paths[`/api/v1/tools/${t.name}`];
      expect(p, t.name).toBeDefined();
      expect(p.post.operationId).toBe(t.name);
      expect(Array.isArray(p.post.parameters)).toBe(true);
      const schema = p.post.requestBody.content["application/json"].schema;
      expect(schema.type).toBe("object");
      expect(schema.$schema).toBeUndefined();
      // 200 envelope reference present
      expect(p.post.responses["200"].content["application/json"].schema.$ref)
        .toBe("#/components/schemas/ToolResponse");
    }
  });

  it("converts all 36 tool schemas without throwing", () => {
    const toolPaths = Object.keys(spec.paths).filter((p: string) => p.startsWith("/api/v1/tools/"));
    expect(toolPaths).toHaveLength(36);
  });

  it("documents discovery, release, the bearer scheme, and the response envelopes", () => {
    expect(spec.paths["/api/v1/tools"].get).toBeDefined();
    expect(spec.paths["/api/v1/profiles/{profile}"].delete).toBeDefined();
    expect(spec.components.securitySchemes.bearerAuth.scheme).toBe("bearer");
    expect(spec.components.schemas.ToolResponse.required).toContain("ok");
    expect(spec.components.schemas.Error).toBeDefined();
  });
});
