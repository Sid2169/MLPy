import {
  createHighlighterCore,
  type HighlighterCore,
  type ThemedToken,
} from "shiki/core";
import { createOnigurumaEngine } from "shiki/engine/oniguruma";

export type CodeHighlighter = (code: string) => ThemedToken[][];

// Load only the grammar being edited, rather than Shiki's full language bundle.
const languageLoaders = {
  python: () => import("shiki/langs/python.mjs"),
  bash: () => import("shiki/langs/bash.mjs"),
  dockerfile: () => import("shiki/langs/dockerfile.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  sql: () => import("shiki/langs/sql.mjs"),
  toml: () => import("shiki/langs/toml.mjs"),
  typescript: () => import("shiki/langs/typescript.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
};

const languageAliases = new Map([
  ["py", "python"],
  ["python3", "python"],
  ["sh", "bash"],
  ["shell", "bash"],
  ["shellscript", "bash"],
  ["docker", "dockerfile"],
  ["ts", "typescript"],
  ["yml", "yaml"],
]);

let highlighterPromise: Promise<HighlighterCore> | undefined;

function getHighlighter() {
  highlighterPromise ??= createHighlighterCore({
    themes: [
      import("shiki/themes/github-light.mjs"),
      import("shiki/themes/github-dark.mjs"),
    ],
    langs: [],
    engine: createOnigurumaEngine(import("shiki/wasm")),
  }).catch((error) => {
    highlighterPromise = undefined;
    throw error;
  });
  return highlighterPromise;
}

export async function loadCodeHighlighter(
  language: string,
): Promise<CodeHighlighter> {
  const highlighter = await getHighlighter();
  const normalized = language.trim().toLowerCase();
  const resolved = languageAliases.get(normalized) ?? normalized;
  const lang = Object.hasOwn(languageLoaders, resolved) ? resolved : "text";

  if (lang !== "text" && !highlighter.getLoadedLanguages().includes(lang)) {
    await highlighter.loadLanguage(
      languageLoaders[lang as keyof typeof languageLoaders](),
    );
  }

  return (code) =>
    highlighter.codeToTokens(code, {
      lang,
      themes: { light: "github-light", dark: "github-dark" },
      defaultColor: false,
    }).tokens;
}
