import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { packageVersion } from "./version.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (file: string) => readFileSync(join(root, file), "utf8");
const pkg = JSON.parse(read("package.json")) as { name: string; version: string; mcpName?: string };
const entry = JSON.parse(read("server.json")) as {
  name: string;
  description: string;
  version: string;
  packages: Array<{ registryType: string; identifier: string; version: string; transport: { type: string }; packageArguments?: Array<{ value?: string }> }>;
};

/**
 * A README's opening line: its first paragraph after the title that starts with a word, past any
 * badge, image, link, quote or code, on one line.
 */
const leadLineOf = (readme: string): string | undefined =>
  readme
    .split(/\n\s*\n/)
    .map((block) => block.replace(/\s+/g, " ").trim())
    .find((block) => /^[A-Za-z]/.test(block));

/** Sentences end at a stop followed by a space or the end, so "0.4" or a link stays whole. */
const sentences = (text: string) => text.trim().split(/(?<=[.!?])\s+/);
const words = (sentence: string) => sentence.split(" ");
const bare = (word: string) => word.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Whether `cut` is the lead line itself or a faithful cut of it: every sentence kept in order and
 * nothing added, the first whole, and each later one keeping at least the first half of its words
 * and ending on a word from the part it shortened.
 */
const faithfulCut = (cut: string, lead: string) => {
  const [short, full] = [sentences(cut), sentences(lead)];
  if (short.length !== full.length || short[0] !== full[0] || !short.every((sentence) => /[.!?]$/.test(sentence))) return false;
  return short.every((sentence, i) => {
    const [a, b] = [words(sentence), words(full[i]!)];
    let kept = 0;
    while (kept < a.length && a[kept] === b[kept]) kept++;
    if (kept === a.length) return a.length === b.length;
    const last = bare(a.at(-1)!);
    return a.length <= b.length && kept >= Math.ceil(b.length / 2) && last !== "" && b.slice(kept).some((word) => bare(word).startsWith(last));
  });
};

describe("the MCP Registry entry", () => {
  it("names the package at its own version, as the registry checks", () => {
    // The registry accepts an npm package only when its published package.json names the entry.
    expect(entry.name).toBe(pkg.mcpName);
    expect(entry.version).toBe(pkg.version);
    expect(entry.packages).toHaveLength(1);
    const [npm] = entry.packages;
    expect({ registryType: npm!.registryType, identifier: npm!.identifier, version: npm!.version, transport: npm!.transport.type }).toEqual({
      registryType: "npm",
      identifier: pkg.name,
      version: pkg.version,
      transport: "stdio",
    });
    // Run as `t3-watch mcp`, the relay to the running service.
    expect(npm!.packageArguments?.map((a) => a.value)).toEqual(["mcp"]);
  });

  it("carries the README's lead line, or its faithful cut, within the registry's 100 characters", () => {
    const lead = leadLineOf(read("README.md"));
    expect(lead, "the README opens with a line of words after its title").toBeDefined();
    expect(entry.description.length).toBeLessThanOrEqual(100);
    if (lead!.length <= 100) expect(entry.description).toBe(lead);
    expect(faithfulCut(entry.description, lead!), `"${entry.description}" is not a faithful cut of "${lead}"`).toBe(true);
  });

  it("tells a faithful cut from drift", () => {
    const lead = "An agent on call for the things nobody watches. Checks run free; your agent wakes only when something changes.";
    expect(faithfulCut("An agent on call for the things nobody watches. Checks run free; your agent wakes only on a change.", lead)).toBe(true);
    expect(faithfulCut(lead, lead)).toBe(true);
    // Text added past the last sentence, a sentence changed, one dropped, or a new ending.
    expect(faithfulCut("An agent on call for the things nobody watches. Checks run free; your agent wakes only on a change. Free forever", lead)).toBe(false);
    expect(faithfulCut("An agent on call for the things nobody watches. Try it now.", lead)).toBe(false);
    expect(faithfulCut("An agent on call for the things nobody watches.", lead)).toBe(false);
    expect(faithfulCut("An agent on call for the things nobody watches. Checks run free; your agent wakes only for billing.", lead)).toBe(false);
    expect(faithfulCut("An agent on call for the things nobody watches! Checks run free; your agent wakes only on a change.", lead)).toBe(false);
    // An ending that is no word, or a word only from the part it kept.
    expect(faithfulCut("An agent on call for the things nobody watches. Checks run free; your agent wakes only on a -.", lead)).toBe(false);
    expect(faithfulCut("An agent on call for the things nobody watches. Checks run free; your agent wakes only on checks.", lead)).toBe(false);
    // A stop inside a number is no sentence's end.
    expect(faithfulCut("Watch 0.4 runs checks free. Your agent wakes only on a change.", "Watch 0.4 runs checks free. Your agent wakes only when something changes.")).toBe(true);
  });

  it("finds the lead line past a badge or an image under the title", () => {
    const readme = ["# t3-watch", "[![npm](https://img.example/npm.svg)](https://npm.example)", "![Home](docs/home.png)", "An agent on call.\nChecks run free.", "More."];
    expect(leadLineOf(readme.join("\n\n"))).toBe("An agent on call. Checks run free.");
    expect(leadLineOf("# t3-watch\n\n[Docs](https://docs.example)\n\n> Status: beta\n\n```sh\nnpx x\n```\n\nWatch it.")).toBe("Watch it.");
    expect(leadLineOf("# t3-watch\n\n![Home](docs/home.png)")).toBeUndefined();
  });
});

describe("the package's version", () => {
  it("is read from package.json, and a broken or blank one reads as 0.0.0", () => {
    expect(packageVersion(root)).toBe(pkg.version);
    const folder = mkdtempSync(join(tmpdir(), "t3w-version-"));
    try {
      for (const text of ["{ not json", JSON.stringify({ version: "" }), JSON.stringify({ version: 4 }), JSON.stringify({})]) {
        writeFileSync(join(folder, "package.json"), text);
        expect(packageVersion(folder), text).toBe("0.0.0");
      }
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
});
