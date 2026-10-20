import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { listenHosts, loadConfig, localUrl, pageUrl, type WatchConfig } from "./config.ts";

const config = (host: string, publicUrl: string | null = null): WatchConfig => ({
  port: 8460,
  host,
  token: "t",
  roots: [],
  publicUrl,
});

describe("config", () => {
  it("reaches the service on the address it listens on", () => {
    expect(localUrl(config("127.0.0.1"))).toBe("http://127.0.0.1:8460");
    expect(localUrl(config("100.64.0.7"))).toBe("http://100.64.0.7:8460");
    expect(localUrl(config("0.0.0.0"))).toBe("http://127.0.0.1:8460");
    expect(localUrl(config("::1"))).toBe("http://[::1]:8460");
    expect(localUrl(config("[::1]"))).toBe("http://[::1]:8460");
    expect(new URL("/mcp", localUrl(config("[::1]"))).href).toBe("http://[::1]:8460/mcp");
  });

  it("loads a bracketed IPv6 host as the bare address listen() needs", () => {
    const home = mkdtempSync(join(tmpdir(), "t3w-config-"));
    try {
      writeFileSync(join(home, "config.json"), JSON.stringify({ host: "[::1]", token: "t", roots: [] }));
      expect(loadConfig(home).host).toBe("::1");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("keeps probeUrls only when someone set it", () => {
    const home = mkdtempSync(join(tmpdir(), "t3w-config-"));
    try {
      const file = join(home, "config.json");
      writeFileSync(file, JSON.stringify({ host: "127.0.0.1", token: "t", roots: [] }));
      expect(loadConfig(home).probeUrls).toBeUndefined();
      expect("probeUrls" in (JSON.parse(readFileSync(file, "utf8")) as object)).toBe(false);
      writeFileSync(file, JSON.stringify({ host: "127.0.0.1", token: "t", roots: [], probeUrls: [] }));
      expect(loadConfig(home).probeUrls).toEqual([]);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("also listens on loopback when bound to one other address", () => {
    expect(listenHosts(config("100.64.0.7"))).toEqual(["100.64.0.7", "127.0.0.1"]);
    expect(listenHosts(config("127.0.0.1"))).toEqual(["127.0.0.1"]);
    expect(listenHosts(config("0.0.0.0"))).toEqual(["0.0.0.0"]);
    expect(listenHosts(config("::1"))).toEqual(["::1"]);
    expect(listenHosts(config("localhost"))).toEqual(["localhost"]);
  });

  it("links to the public address when there is one", () => {
    expect(pageUrl(config("100.64.0.7"))).toBe("http://100.64.0.7:8460");
    expect(pageUrl(config("127.0.0.1", "https://watch.example"))).toBe("https://watch.example");
  });
});
