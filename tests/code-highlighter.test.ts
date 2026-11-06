import { describe, expect, it } from "vitest";
import { loadCodeHighlighter } from "../lib/code-highlighter";

describe("editable code highlighting", () => {
  it("preserves whitespace, incomplete code, and literal HTML as token text", async () => {
    const highlight = await loadCodeHighlighter("python");
    for (const code of [
      "",
      "\n\n",
      "def greet(name):\n\treturn f'hello {name}'\n\n",
      'print("<img src=x onerror=alert(1)>")\n',
      'values = [1, 2,\n  "unfinished',
    ]) {
      const text = highlight(code)
        .map((line) => line.map((token) => token.content).join(""))
        .join("\n");
      expect(text).toBe(code);
    }
  });

  it("provides distinct token colors for both course themes and every code language", async () => {
    const snippets = [
      ["python", 'def greet(name):\n    return f"Hello {name}"'],
      ["bash", 'echo "hello" # comment'],
      ["dockerfile", 'FROM python:3.12\nRUN echo "hello"'],
      ["json", '{"ready": true, "count": 42}'],
      ["sql", "SELECT name FROM users WHERE id = 42"],
      ["toml", '[project]\nname = "mlpy"\nversion = 1'],
      ["typescript", 'const greet = (name: string) => `Hello ${name}`;'],
      ["yaml", 'name: "mlpy"\nready: true\ncount: 42'],
    ];
    for (const [language, code] of snippets) {
      const highlight = await loadCodeHighlighter(language);
      const tokens = highlight(code).flat();
      for (const theme of ["light", "dark"]) {
        const colors = new Set(tokens.map((token) => token.htmlStyle?.[`--shiki-${theme}`]));
        expect(colors.size, `${language} in ${theme} mode`).toBeGreaterThan(1);
      }
      expect(tokens.some((token) =>
        token.htmlStyle?.["--shiki-light"] !== token.htmlStyle?.["--shiki-dark"],
      )).toBe(true);
    }
  });

  it("handles language aliases and plain or unknown languages", async () => {
    const code = 'const name: string = "MLPy";';
    const [typescript, alias] = await Promise.all([
      loadCodeHighlighter("typescript"),
      loadCodeHighlighter("ts"),
    ]);
    expect(alias(code)).toEqual(typescript(code));

    for (const language of ["text", "unknown-language"]) {
      const highlight = await loadCodeHighlighter(language);
      expect(highlight(code).flat().map((token) => token.content).join("")).toBe(code);
    }
  });
});
