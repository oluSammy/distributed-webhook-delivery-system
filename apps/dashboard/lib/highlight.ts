import type { HighlighterCore, ThemedToken } from "shiki/core";
import { createCssVariablesTheme, createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

// The languages code blocks can colour. Each grammar is downloaded the first time it's needed.
const grammars = {
  json: () => import("shiki/langs/json.mjs"),
  html: () => import("shiki/langs/html.mjs"),
  bash: () => import("shiki/langs/shellscript.mjs"),
  javascript: () => import("shiki/langs/javascript.mjs"),
};

export type Language = keyof typeof grammars;

const theme = createCssVariablesTheme({ name: "css-variables", variablePrefix: "--shiki-" });
let highlighter: Promise<HighlighterCore> | undefined;

// Splits code into lines of coloured pieces. Each piece's color is a var(--shiki-…).
export async function tokenize(code: string, language: Language): Promise<ThemedToken[][]> {
  highlighter ??= createHighlighterCore({
    themes: [theme],
    langs: [],
    // Shiki's own regex engine, in plain JavaScript: smaller than the WebAssembly one.
    engine: createJavaScriptRegexEngine(),
  });
  const shiki = await highlighter;
  const name = language === "bash" ? "shellscript" : language;
  if (!shiki.getLoadedLanguages().includes(name)) {
    await shiki.loadLanguage(grammars[language]());
  }
  return shiki.codeToTokens(code, { lang: name, theme: "css-variables" }).tokens;
}
