import { createServer, type Server } from "node:http";

/**
 * Minimal in-process HTTP server for integration tests. Serves configurable
 * routes so we can exercise HTTP-status branches (2xx, 4xx, 5xx) and network
 * log formatting without depending on the internet.
 */
export type RouteSpec = {
  status?: number;
  headers?: Record<string, string>;
  body?: string;
  delayMs?: number;
  failWith?: string; // abort connection with this error before responding
};

export async function startTestServer(routes: Record<string, RouteSpec>): Promise<{
  url: (path: string) => string;
  port: number;
  close: () => Promise<void>;
}> {
  const server: Server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    const spec = routes[path];
    if (!spec) {
      res.statusCode = 404;
      res.end("no route");
      return;
    }
    if (spec.failWith) {
      res.destroy(new Error(spec.failWith));
      return;
    }
    const go = () => {
      res.statusCode = spec.status ?? 200;
      for (const [k, v] of Object.entries(spec.headers ?? {})) res.setHeader(k, v);
      if (!res.hasHeader("content-type")) res.setHeader("content-type", "text/html; charset=utf-8");
      res.end(spec.body ?? "");
    };
    if (spec.delayMs) setTimeout(go, spec.delayMs);
    else go();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return {
    port,
    url: (p: string) => `http://127.0.0.1:${port}${p.startsWith("/") ? p : "/" + p}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
