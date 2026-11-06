// Tokenização de código (Shiki, com as gramáticas e os temas do VS Code) fora da thread
// principal, para a rolagem não travar em arquivos grandes.
import { createHighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import { LANG_LOADERS } from './languages.js';

const THEMES = { light: 'github-light', dark: 'github-dark' };

let highlighterPromise = null;
const highlighter = () =>
  (highlighterPromise ??= createHighlighterCore({
    themes: [import('shiki/themes/github-light.mjs'), import('shiki/themes/github-dark.mjs')],
    langs: [],
    engine: createJavaScriptRegexEngine({ forgiving: true }),
  }));

const loading = new Map();
async function ensureLang(h, lang) {
  if (h.getLoadedLanguages().includes(lang)) return;
  if (!loading.has(lang)) loading.set(lang, h.loadLanguage(LANG_LOADERS[lang]()));
  await loading.get(lang);
}

/** Estilo inline de um token: cor clara/escura como variáveis CSS, itálico e negrito. */
function styleOf(tok) {
  const light = tok.variants.light ?? {};
  const dark = tok.variants.dark ?? {};
  let s = '';
  if (light.color) s += `--l:${light.color};`;
  if (dark.color) s += `--d:${dark.color};`;
  const fs = light.fontStyle ?? 0;
  if (fs > 0 && fs & 1) s += 'font-style:italic;';
  if (fs > 0 && fs & 2) s += 'font-weight:600;';
  return s;
}

self.onmessage = async (e) => {
  const { id, lang, code } = e.data;
  try {
    if (!LANG_LOADERS[lang]) throw new Error(`linguagem sem realce: ${lang}`);
    const h = await highlighter();
    await ensureLang(h, lang);
    const lines = h.codeToTokensWithThemes(code, { lang, themes: THEMES });
    self.postMessage({ id, lines: lines.map((line) => line.map((tok) => [tok.content, styleOf(tok)])) });
  } catch (err) {
    self.postMessage({ id, error: String(err?.message ?? err) });
  }
};
