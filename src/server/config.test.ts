import { describe, expect, it } from "vitest";

import { localUrl, pageUrl, signInLine, type WatchConfig } from "./config.ts";

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

  it("prints the token-bearing sign-in link only to a terminal", () => {
    const withToken = { ...config("127.0.0.1"), token: "secret-token-value" };
    expect(signInLine(withToken, true)).toContain("/signin?token=secret-token-value");
    expect(signInLine(withToken, false)).not.toContain("secret-token-value");
    expect(signInLine(withToken, false)).toContain("t3-watch url");
  });

  it("links to the public address when there is one", () => {
    expect(pageUrl(config("100.64.0.7"))).toBe("http://100.64.0.7:8460");
    expect(pageUrl(config("127.0.0.1", "https://watch.example"))).toBe("https://watch.example");
  });
});
