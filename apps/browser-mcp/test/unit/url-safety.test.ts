import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { assertNavigableUrl, assertOriginUrl } from "../../src/lib/url-safety.js";

describe("assertNavigableUrl — default (strict) policy", () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    saved.FILE = process.env.BROWSER_MCP_ALLOW_FILE_URLS;
    saved.PRIV = process.env.BROWSER_MCP_ALLOW_PRIVATE_NETWORKS;
    delete process.env.BROWSER_MCP_ALLOW_FILE_URLS;
    delete process.env.BROWSER_MCP_ALLOW_PRIVATE_NETWORKS;
  });
  afterEach(() => {
    if (saved.FILE !== undefined) process.env.BROWSER_MCP_ALLOW_FILE_URLS = saved.FILE;
    if (saved.PRIV !== undefined) process.env.BROWSER_MCP_ALLOW_PRIVATE_NETWORKS = saved.PRIV;
  });

  it("allows http:// and https:// to public hostnames", () => {
    expect(() => assertNavigableUrl("http://example.com/")).not.toThrow();
    expect(() => assertNavigableUrl("https://example.com/path?q=1")).not.toThrow();
  });

  it("allows about:blank only", () => {
    expect(() => assertNavigableUrl("about:blank")).not.toThrow();
    expect(() => assertNavigableUrl("about:srcdoc")).toThrow(/about: scheme/);
    expect(() => assertNavigableUrl("about:config")).toThrow(/about: scheme/);
  });

  it("blocks file://", () => {
    expect(() => assertNavigableUrl("file:///etc/passwd")).toThrow(/file:\/\/ URLs are blocked/);
    expect(() => assertNavigableUrl("file:///Users/x/.ssh/id_rsa")).toThrow();
  });

  it("blocks javascript: / data: / chrome: / view-source: / ftp:", () => {
    expect(() => assertNavigableUrl("javascript:alert(1)")).toThrow(/scheme 'javascript:' is not allowed/);
    expect(() => assertNavigableUrl("data:text/html,<script>x</script>")).toThrow(/scheme 'data:' is not allowed/);
    expect(() => assertNavigableUrl("chrome://settings")).toThrow();
    expect(() => assertNavigableUrl("view-source:https://example.com")).toThrow();
    expect(() => assertNavigableUrl("ftp://example.com/")).toThrow();
  });

  it("throws on malformed URL", () => {
    expect(() => assertNavigableUrl("not a url")).toThrow(/invalid URL/);
    expect(() => assertNavigableUrl("")).toThrow(/invalid URL/);
  });

  it("blocks loopback IPv4", () => {
    expect(() => assertNavigableUrl("http://127.0.0.1:8080/")).toThrow(/private\/loopback\/link-local/);
    expect(() => assertNavigableUrl("http://127.1.2.3/")).toThrow();
  });

  it("blocks 0.0.0.0", () => {
    expect(() => assertNavigableUrl("http://0.0.0.0/")).toThrow();
  });

  it("blocks 10/8, 172.16/12, 192.168/16, 169.254/16 (RFC1918 + link-local)", () => {
    expect(() => assertNavigableUrl("http://10.0.0.1/")).toThrow();
    expect(() => assertNavigableUrl("http://172.16.0.1/")).toThrow();
    expect(() => assertNavigableUrl("http://172.31.255.255/")).toThrow();
    expect(() => assertNavigableUrl("http://192.168.1.1/")).toThrow();
    expect(() => assertNavigableUrl("http://169.254.169.254/latest/meta-data/")).toThrow(); // AWS IMDS
  });

  it("allows non-private IPv4 ranges that LOOK private-adjacent", () => {
    expect(() => assertNavigableUrl("http://11.0.0.1/")).not.toThrow();
    expect(() => assertNavigableUrl("http://172.15.0.1/")).not.toThrow(); // one below the private band
    expect(() => assertNavigableUrl("http://172.32.0.1/")).not.toThrow(); // one above
    expect(() => assertNavigableUrl("http://168.254.0.1/")).not.toThrow();
  });

  it("blocks IPv6 loopback, ULA, link-local", () => {
    expect(() => assertNavigableUrl("http://[::1]/")).toThrow();
    expect(() => assertNavigableUrl("http://[::]/")).toThrow();
    expect(() => assertNavigableUrl("http://[fc00::1]/")).toThrow();
    expect(() => assertNavigableUrl("http://[fd12::1]/")).toThrow();
    expect(() => assertNavigableUrl("http://[fe80::1]/")).toThrow();
  });

  it("allows public IPv6", () => {
    expect(() => assertNavigableUrl("http://[2606:4700::1]/")).not.toThrow();
  });

  it("blocks 'localhost' hostname explicitly (not an IP, but same intent)", () => {
    expect(() => assertNavigableUrl("http://localhost:3000/")).toThrow();
  });
});

describe("assertNavigableUrl — with BROWSER_MCP_ALLOW_FILE_URLS=1", () => {
  let prev: string | undefined;
  beforeEach(() => { prev = process.env.BROWSER_MCP_ALLOW_FILE_URLS; process.env.BROWSER_MCP_ALLOW_FILE_URLS = "1"; });
  afterEach(() => { if (prev === undefined) delete process.env.BROWSER_MCP_ALLOW_FILE_URLS; else process.env.BROWSER_MCP_ALLOW_FILE_URLS = prev; });

  it("permits file:// URLs", () => {
    expect(() => assertNavigableUrl("file:///tmp/foo.html")).not.toThrow();
  });

  it("still rejects javascript: and data:", () => {
    expect(() => assertNavigableUrl("javascript:alert(1)")).toThrow();
    expect(() => assertNavigableUrl("data:text/html,x")).toThrow();
  });
});

describe("assertNavigableUrl — BROWSER_MCP_ALLOW_FILE_URLS=0 still blocks", () => {
  let prev: string | undefined;
  beforeEach(() => { prev = process.env.BROWSER_MCP_ALLOW_FILE_URLS; process.env.BROWSER_MCP_ALLOW_FILE_URLS = "0"; });
  afterEach(() => { if (prev === undefined) delete process.env.BROWSER_MCP_ALLOW_FILE_URLS; else process.env.BROWSER_MCP_ALLOW_FILE_URLS = prev; });

  it("empty string env treated as disabled", () => {
    process.env.BROWSER_MCP_ALLOW_FILE_URLS = "";
    expect(() => assertNavigableUrl("file:///x")).toThrow();
  });

  it("'0' env treated as disabled", () => {
    expect(() => assertNavigableUrl("file:///x")).toThrow();
  });
});

describe("assertNavigableUrl — with BROWSER_MCP_ALLOW_PRIVATE_NETWORKS=1", () => {
  let prev: string | undefined;
  beforeEach(() => { prev = process.env.BROWSER_MCP_ALLOW_PRIVATE_NETWORKS; process.env.BROWSER_MCP_ALLOW_PRIVATE_NETWORKS = "1"; });
  afterEach(() => { if (prev === undefined) delete process.env.BROWSER_MCP_ALLOW_PRIVATE_NETWORKS; else process.env.BROWSER_MCP_ALLOW_PRIVATE_NETWORKS = prev; });

  it("permits loopback", () => {
    expect(() => assertNavigableUrl("http://127.0.0.1:3000/")).not.toThrow();
    expect(() => assertNavigableUrl("http://localhost:3000/")).not.toThrow();
  });

  it("permits RFC1918 addresses", () => {
    expect(() => assertNavigableUrl("http://10.0.0.1/")).not.toThrow();
    expect(() => assertNavigableUrl("http://192.168.1.1/")).not.toThrow();
  });
});

describe("assertOriginUrl", () => {
  it("accepts http(s)", () => {
    expect(() => assertOriginUrl("https://example.com")).not.toThrow();
    expect(() => assertOriginUrl("http://example.com")).not.toThrow();
  });

  it("rejects non-http(s) schemes regardless of file-url opt-in", () => {
    const prev = process.env.BROWSER_MCP_ALLOW_FILE_URLS;
    process.env.BROWSER_MCP_ALLOW_FILE_URLS = "1";
    try {
      // file:// is parseable but not an http(s) origin
      expect(() => assertOriginUrl("file:///x")).toThrow(/origin must be http/);
    } finally {
      if (prev === undefined) delete process.env.BROWSER_MCP_ALLOW_FILE_URLS;
      else process.env.BROWSER_MCP_ALLOW_FILE_URLS = prev;
    }
  });
});
