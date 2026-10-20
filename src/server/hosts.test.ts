import { describe, expect, it } from "vitest";

import { hostClass } from "./hosts.ts";

describe("hostClass", () => {
  it("places addresses and names on this machine, the local network or the internet", () => {
    const cases: Record<string, ReadonlyArray<string>> = {
      loopback: ["localhost", "localhost.", "app.localhost", "127.0.0.1", "127.8.9.10", "::1", "[::1]", "::ffff:127.0.0.1", "::ffff:7f00:1", "0.0.0.0", "::"],
      // The local network includes the tailnet.
      local: ["10.0.0.2", "172.20.0.5", "192.168.1.10", "169.254.1.1", "fd00::1", "fe80::1", "nas.local", "router.lan", "db.internal", "printer.home.arpa", "100.65.64.7", "::ffff:6441:4007", "fd7a:115c:a1e0::1", "leviathan.tail5ed0f2.ts.net"],
      internet: ["example.com", "8.8.8.8", "172.32.0.1", "100.128.0.1", "2606:4700::1111", "fc::1", "fe8::1"],
    };
    for (const [expected, hosts] of Object.entries(cases))
      for (const host of hosts) expect(hostClass(host), host).toBe(expected);
  });
});
