/**
 * Linguagens com realce de sintaxe. Cada gramática (as mesmas do VS Code) só é baixada
 * quando aparece um arquivo dela.
 */
export const LANG_LOADERS = {
  javascript: () => import('shiki/langs/javascript.mjs'),
  jsx: () => import('shiki/langs/jsx.mjs'),
  typescript: () => import('shiki/langs/typescript.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  vue: () => import('shiki/langs/vue.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  jsonc: () => import('shiki/langs/jsonc.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  scss: () => import('shiki/langs/scss.mjs'),
  less: () => import('shiki/langs/less.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
  toml: () => import('shiki/langs/toml.mjs'),
  shellscript: () => import('shiki/langs/shellscript.mjs'),
  dockerfile: () => import('shiki/langs/dockerfile.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  graphql: () => import('shiki/langs/graphql.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  go: () => import('shiki/langs/go.mjs'),
  java: () => import('shiki/langs/java.mjs'),
  kotlin: () => import('shiki/langs/kotlin.mjs'),
  php: () => import('shiki/langs/php.mjs'),
  ruby: () => import('shiki/langs/ruby.mjs'),
  rust: () => import('shiki/langs/rust.mjs'),
  csharp: () => import('shiki/langs/csharp.mjs'),
  xml: () => import('shiki/langs/xml.mjs'),
  dotenv: () => import('shiki/langs/dotenv.mjs'),
};

const BY_EXT = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx',
  ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'tsx',
  vue: 'vue', json: 'json', jsonc: 'jsonc', css: 'css', scss: 'scss', less: 'less',
  html: 'html', htm: 'html', md: 'markdown', markdown: 'markdown', yml: 'yaml', yaml: 'yaml',
  toml: 'toml', sh: 'shellscript', bash: 'shellscript', zsh: 'shellscript', sql: 'sql',
  graphql: 'graphql', gql: 'graphql', py: 'python', go: 'go', java: 'java', kt: 'kotlin',
  php: 'php', rb: 'ruby', rs: 'rust', cs: 'csharp', xml: 'xml', svg: 'xml',
};

const BY_NAME = { Dockerfile: 'dockerfile', Makefile: 'shellscript', '.env': 'dotenv', 'tsconfig.json': 'jsonc', 'jsconfig.json': 'jsonc' };

/** Linguagem de um caminho, ou null se não houver realce para ela. */
export function langFor(path) {
  if (!path) return null;
  const name = path.split('/').pop();
  if (BY_NAME[name]) return BY_NAME[name];
  if (/^\.env(\.|$)/.test(name)) return 'dotenv';
  if (/^Dockerfile/.test(name)) return 'dockerfile';
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  return BY_EXT[ext] ?? null;
}
