import fs from "node:fs";
import path from "node:path";
import postcss, { type AtRule, type Node, type Rule } from "postcss";
import { describe, expect, it } from "vitest";

// docs/mobile-pwa/SPEC.md, P6 standalone niceties: in the installed app a long
// press on nav chrome doesn't select its label or pop the link menu. That must
// stay scoped to `display-mode: standalone` (a browser tab keeps the normal
// behaviour), touch only the chrome (nav, .nav-chrome, buttons), never the
// page content, and leave fields inside the chrome typeable.

const root = path.resolve(__dirname, "../..");
const css = postcss.parse(fs.readFileSync(path.join(root, "app/globals.css"), "utf8"));

function inStandalone(node: Rule): boolean {
  for (let p: Node | undefined = node.parent as Node | undefined; p; p = p.parent as Node | undefined) {
    if (p.type === "atrule" && (p as AtRule).name === "media" && /display-mode:\s*standalone/.test((p as AtRule).params)) {
      return true;
    }
  }
  return false;
}

function decl(rule: Rule, prop: string): string | undefined {
  let value: string | undefined;
  rule.walkDecls(prop, (d) => {
    value = d.value;
  });
  return value;
}

const standaloneBlocks: AtRule[] = [];
css.walkAtRules("media", (at) => {
  if (/display-mode:\s*standalone/.test(at.params)) standaloneBlocks.push(at);
});

const standaloneRules: Rule[] = [];
css.walkRules((r) => {
  if (inStandalone(r)) standaloneRules.push(r);
});

describe("standalone CSS (app/globals.css)", () => {
  it("has exactly one @media (display-mode: standalone) block, at the top level", () => {
    expect(standaloneBlocks).toHaveLength(1);
    expect(standaloneBlocks[0].params.replace(/\s+/g, " ").trim()).toBe("(display-mode: standalone)");
    // Not nested under another query (a max-lg, a hover query) that would narrow it further.
    expect(standaloneBlocks[0].parent?.type).toBe("root");
  });

  it("turns off selection on nav, .nav-chrome and buttons", () => {
    const off = standaloneRules.find((r) => decl(r, "user-select") === "none");
    expect(off).toBeDefined();
    expect(decl(off!, "-webkit-user-select")).toBe("none");
    const sel = off!.selector.replace(/\s+/g, "");
    for (const s of ["nav", ".nav-chrome", "button"]) expect(sel).toContain(s);
  });

  it("turns off the link callout on nav and .nav-chrome only (not on every button)", () => {
    const callouts = standaloneRules.filter((r) => decl(r, "-webkit-touch-callout") !== undefined);
    expect(callouts).toHaveLength(1);
    expect(decl(callouts[0], "-webkit-touch-callout")).toBe("none");
    const sel = callouts[0].selector.replace(/\s+/g, "");
    expect(sel).toBe(":is(nav,.nav-chrome)");
  });

  it("only ever targets nav chrome and buttons, never page content", () => {
    for (const r of standaloneRules) {
      // Every selector in the block is rooted in nav, .nav-chrome or button.
      expect(r.selector).toMatch(/^:is\((nav|\.nav-chrome|button)(,\s*(nav|\.nav-chrome|button))*\)/);
      expect(r.selector).not.toMatch(/\b(html|body|main|p|h[1-6]|span|div)\b|\*/);
    }
  });

  it("keeps fields inside nav chrome selectable (iOS won't type into a user-select: none input)", () => {
    const fields = standaloneRules.find((r) => decl(r, "user-select") === "text");
    expect(fields).toBeDefined();
    expect(decl(fields!, "-webkit-user-select")).toBe("text");
    for (const s of ["input", "textarea", '[contenteditable="true"]']) expect(fields!.selector).toContain(s);
    // Comes after the rule that turns selection off, so it wins at equal specificity.
    const off = standaloneRules.find((r) => decl(r, "user-select") === "none")!;
    expect(off.source!.start!.offset).toBeLessThan(fields!.source!.start!.offset);
  });

  it("puts -webkit-touch-callout and selection rules on nav/.nav-chrome nowhere outside that block", () => {
    css.walkRules((r) => {
      if (inStandalone(r)) return;
      expect(decl(r, "-webkit-touch-callout")).toBeUndefined();
      if (/\bnav\b|\.nav-chrome/.test(r.selector)) expect(decl(r, "user-select")).toBeUndefined();
    });
  });
});
