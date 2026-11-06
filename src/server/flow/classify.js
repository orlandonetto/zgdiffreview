import { posix } from 'node:path';

/**
 * Camadas na ordem em que se lê uma aplicação, de fora para dentro.
 * Cada uma casa por nome de pasta ou de arquivo (sem extensão, sem sufixos como .test).
 */
export const DEFAULT_LAYERS = [
  { id: 'entry', label: 'Entrada', names: ['server', 'index', 'main', 'bootstrap', 'cli', 'bin', 'www'] },
  { id: 'app', label: 'App', names: ['app', 'App', 'application'] },
  { id: 'config', label: 'Config/middlewares', names: ['config', 'configs', 'settings', 'middleware', 'middlewares', 'plugins', 'boot', 'loaders', 'setup'] },
  { id: 'routes', label: 'Rotas', names: ['routes', 'route', 'router', 'routers', 'api', 'endpoints'] },
  { id: 'pages', label: 'Páginas', names: ['pages', 'views', 'screens'] },
  { id: 'layouts', label: 'Layouts', names: ['layouts', 'layout'] },
  { id: 'validation', label: 'Validação', names: ['validators', 'validator', 'validations', 'validation', 'schemas', 'schema', 'celebrate'] },
  { id: 'controllers', label: 'Controllers', names: ['controllers', 'controller', 'handlers', 'handler', 'resolvers'] },
  { id: 'components', label: 'Componentes', names: ['components', 'component', 'widgets'] },
  { id: 'state', label: 'Estado', names: ['store', 'stores', 'composables', 'hooks', 'state'] },
  { id: 'services', label: 'Services', names: ['services', 'service', 'usecases', 'use-cases', 'domain', 'business', 'jobs', 'workers', 'queues', 'consumers'] },
  { id: 'data', label: 'Dados', names: ['dao', 'daos', 'repositories', 'repository', 'repos', 'db', 'database', 'datasource', 'clients', 'integrations', 'gateways'] },
  { id: 'models', label: 'Models/tipos', names: ['models', 'model', 'entities', 'entity', 'types', 'dto', 'dtos', 'interfaces', 'enums', 'constants', 'errors'] },
  { id: 'utils', label: 'Utils', names: ['utils', 'util', 'helpers', 'helper', 'lib', 'libs', 'common', 'shared'] },
];

const OTHER_LAYER = { id: 'other', label: 'Outros' };

const TEST_RE = /(^|\/)(__tests__|__mocks__|tests?|spec|specs|e2e|cypress|playwright)(\/|$)|\.(test|spec|e2e)\.[a-z]+$/i;
const CONFIG_NAMES = new Set([
  'package.json', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'npm-shrinkwrap.json', 'bun.lockb',
  'tsconfig.json', 'jsconfig.json', '.eslintrc', '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.json', 'eslint.config.js',
  '.prettierrc', '.prettierrc.json', '.editorconfig', '.gitignore', '.npmrc', '.nvmrc', 'Dockerfile', 'docker-compose.yml',
  'docker-compose.yaml', 'cloudbuild.yaml', 'cloudbuild.yml', 'Makefile', 'Procfile', '.zgdiff.json', 'deploy.sh',
]);
const CODE_EXT_RE = /\.(m|c)?[jt]sx?$|\.vue$|\.py$|\.go$|\.rb$|\.java$|\.kt$|\.php$|\.cs$|\.rs$/;

export function isTestFile(path) {
  return TEST_RE.test(path);
}

export function isConfigFile(path) {
  const name = posix.basename(path);
  return (
    CONFIG_NAMES.has(name) ||
    /^\.env(\.|$)/.test(name) ||
    /(^|\/)\.(github|gitlab|circleci|husky|vscode)\//.test(path) ||
    /\.config\.(m|c)?[jt]s$/.test(name) ||
    /\.(ya?ml|toml|ini)$/.test(name)
  );
}

export function isCodePath(path) {
  return CODE_EXT_RE.test(path);
}

/** Nome do arquivo sem extensão e sem sufixos (.test, .spec, .controller...). */
function stem(path) {
  return posix.basename(path).replace(/\.[^.]+$/, '').replace(/\.(test|spec|e2e)$/i, '');
}

/**
 * Camada de um arquivo: a primeira (de fora para dentro) que casa com o nome do arquivo,
 * com um sufixo do nome (users.controller.js) ou com uma pasta do caminho (a mais interna vence).
 *
 * @param {string} path
 * @param {typeof DEFAULT_LAYERS} layers
 * @returns {{ index: number, id: string, label: string }}
 */
export function layerOf(path, layers = DEFAULT_LAYERS) {
  const name = stem(path);
  const parts = name.split(/[.\-_]/);
  const dirs = posix.dirname(path).split('/').filter((d) => d && d !== '.' && d !== 'src');

  const byName = (n) => layers.findIndex((l) => l.names.includes(n));
  // 1) nome do arquivo inteiro (server.js, app.js, routes.js)
  let idx = byName(name);
  // 2) sufixo (users.controller.js, user-service.js)
  if (idx === -1 && parts.length > 1) idx = byName(parts[parts.length - 1]);
  // 3) pasta mais interna que case (src/modules/users/controllers/x.js -> controllers)
  if (idx === -1) {
    for (let k = dirs.length - 1; k >= 0 && idx === -1; k--) idx = byName(dirs[k]);
  }
  // "index" dentro de uma pasta de camada pertence à camada da pasta (routes/index.js).
  if (layers[idx]?.id === 'entry' && name === 'index' && dirs.length) {
    for (let k = dirs.length - 1; k >= 0; k--) {
      const d = byName(dirs[k]);
      if (d !== -1) return { index: d, ...pick(layers[d]) };
    }
  }
  if (idx === -1) return { index: layers.length, ...OTHER_LAYER };
  return { index: idx, ...pick(layers[idx]) };
}

function pick(layer) {
  return { id: layer.id, label: layer.label };
}

/**
 * Para um arquivo de teste, o arquivo de código que ele testa (entre os candidatos), ou null.
 * user.test.js -> user.js; __tests__/user.js -> ../user.js; tests/services/user.spec.js -> src/services/user.js
 */
export function testTarget(testPath, candidates) {
  const testStem = stem(testPath);
  const testDir = posix.dirname(testPath).split('/').filter((d) => !/^(__tests__|tests?|spec|specs)$/i.test(d));
  let best = null;
  let bestScore = -1;
  for (const c of candidates) {
    if (c === testPath || isTestFile(c) || stem(c) !== testStem) continue;
    // Quanto mais pastas em comum (sem as pastas de teste), melhor.
    const dir = posix.dirname(c).split('/');
    let score = 0;
    for (const d of dir) if (testDir.includes(d)) score++;
    if (score > bestScore) {
      best = c;
      bestScore = score;
    }
  }
  return best;
}
