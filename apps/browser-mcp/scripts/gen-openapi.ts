// Emit the OpenAPI 3.1 spec to apps/browser-mcp/openapi.json.
// Run: `npm run openapi`. The spec is also served live at GET /api/v1/openapi.json;
// this static copy is what the JS/TS client generates its types from.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildOpenApiSpec } from "../src/openapi.js";

const out = fileURLToPath(new URL("../openapi.json", import.meta.url));
writeFileSync(out, JSON.stringify(buildOpenApiSpec(), null, 2) + "\n");
console.error(`wrote ${out}`);
