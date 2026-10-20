import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import { shellQuote, systemdQuote } from "./cli.ts";

describe("cli quoting", () => {
  it("prints commands a shell reads back unchanged", () => {
    expect(shellQuote("/usr/bin/node")).toBe("/usr/bin/node");
    for (const word of ["/home/u/My Projects/bin/t3-watch.js", "/Users/o'brien/t3-watch", "/tmp/$HOME/`x`"])
      expect(execFileSync("sh", ["-c", `printf %s ${shellQuote(word)}`], { encoding: "utf8" })).toBe(word);
  });

  it("writes systemd values that survive specifier and variable expansion", () => {
    expect(systemdQuote("/home/u/My Projects/bin/t3-watch.js", true)).toBe('"/home/u/My Projects/bin/t3-watch.js"');
    expect(systemdQuote('/opt/100%/$x/"q"', true)).toBe('"/opt/100%%/$$x/\\"q\\""');
    // Environment= expands specifiers but not variables.
    expect(systemdQuote("PATH=/a:/b%:$c", false)).toBe('"PATH=/a:/b%%:$c"');
  });
});
