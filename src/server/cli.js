import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AppError, ValidationError } from './errors.js';
import { computeReview, currentBranch, DEFAULT_BASES, defaultBase, fetchOrigin, repoRoot } from './git.js';
import { createReviewServer } from './server.js';
import { ReviewStore } from './store.js';
import { runConfigCommand } from './config-command.js';

const HELP = `zgdiff — review de branch no navegador, no estilo GitHub/Bitbucket

Uso:
  zgdiff [base] [branch] [opções]

  base     branch de destino (para onde a PR iria). Padrão: a primeira
           que existir entre ${DEFAULT_BASES.join(', ')}.
  branch   branch (ou commit) a revisar. Padrão: a branch atual.

  Mostra o mesmo que a PR mostraria: tudo o que a branch mudou desde que
  saiu da base (git diff base...branch), todos os commits juntos.

Opções:
  -f, --fetch      roda "git fetch origin" antes de comparar
  -p, --port <n>   porta local (padrão: 7420, ou a próxima livre)
      --no-open    não abre o navegador
  -v, --version    mostra a versão
  -h, --help       mostra esta ajuda

Configuração do chat (LLM):
  zgdiff config            mostra a configuração (veja "zgdiff config help")

Exemplos:
  zgdiff develop feature/teste1         # feature/teste1 vs develop
  zgdiff develop                        # branch atual vs develop
  zgdiff                                # branch atual vs base padrão
  zgdiff main origin/feature/x -f       # atualiza e compara com main
`;

/**
 * @param {string[]} argv
 * @returns {{ base?: string, head?: string, fetch: boolean, port?: number, open: boolean } | 'help' | 'version'}
 */
export function parseArgs(argv) {
  const args = { fetch: false, open: true, base: undefined, head: undefined, port: undefined };
  const positional = [];
  for (let k = 0; k < argv.length; k++) {
    const a = argv[k];
    if (a === '-h' || a === '--help') return 'help';
    if (a === '-v' || a === '--version') return 'version';
    if (a === '-f' || a === '--fetch') args.fetch = true;
    else if (a === '--no-open') args.open = false;
    else if (a === '-p' || a === '--port') {
      const v = Number(argv[++k]);
      if (!Number.isInteger(v) || v < 1 || v > 65535) throw new ValidationError('--port precisa de um número entre 1 e 65535.');
      args.port = v;
    } else if (a.startsWith('-')) throw new ValidationError(`Opção desconhecida: ${a}`);
    else positional.push(a);
  }
  if (positional.length > 2) throw new ValidationError('Informe no máximo [base] e [branch].');
  [args.base, args.head] = positional;
  return args;
}

function listen(server, port, tries) {
  return new Promise((resolve, reject) => {
    const onError = (err) => {
      server.off('listening', onListening);
      if (err.code === 'EADDRINUSE' && tries > 1) resolve(listen(server, port + 1, tries - 1));
      else reject(err);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve(port);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
}

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  spawn(cmd, args, { stdio: 'ignore', detached: true })
    .on('error', () => console.log(`Abra no navegador: ${url}`))
    .unref();
}

async function main(argv, version) {
  if (argv[0] === 'config') {
    await runConfigCommand(argv.slice(1));
    return;
  }
  const args = parseArgs(argv);
  if (args === 'help') {
    process.stdout.write(HELP);
    return;
  }
  if (args === 'version') {
    console.log(version);
    return;
  }

  const webDir = fileURLToPath(new URL('../../dist/web', import.meta.url));
  if (!existsSync(webDir)) {
    throw new ValidationError('Interface não encontrada (dist/web). Rode "npm run build" no projeto do zgdiff.');
  }

  const root = await repoRoot(process.cwd());
  if (args.fetch) {
    console.log('Atualizando (git fetch origin)...');
    await fetchOrigin(root);
  }
  const base = args.base ?? (await defaultBase(root));
  const head = args.head ?? (await currentBranch(root));

  // Valida antes de subir o servidor, para o erro aparecer no terminal.
  const review = await computeReview(root, base, head);
  if (review.headSha === review.mergeBaseSha) {
    console.log(`Aviso: ${head} não tem commits que não estejam em ${base}.`);
  }

  const store = new ReviewStore(root, review.repoName, head, base);
  await store.load();

  const { server, setPort, init, close } = createReviewServer({ root, base, head, store, webDir });
  await init();
  const port = await listen(server, args.port ?? 7420, args.port ? 1 : 20);
  setPort(port);

  const url = `http://127.0.0.1:${port}/`;
  const adds = review.files.reduce((s, f) => s + f.additions, 0);
  const dels = review.files.reduce((s, f) => s + f.deletions, 0);
  console.log(`\n  ${head} → ${base}  ·  ${review.files.length} arquivo(s)  ·  +${adds} −${dels}`);
  console.log(`  Review em ${url}`);
  console.log(`  Comentários salvos em ${store.path}`);
  console.log('  Ctrl+C para encerrar.\n');
  if (args.open) openBrowser(url);

  const stop = () => {
    close();
    server.close(() => process.exit(0));
    // Conexões de streaming abertas não podem segurar o encerramento.
    setTimeout(() => process.exit(0), 500).unref();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

/** Ponto de entrada usado por bin/zgdiff.js. */
export function run(argv, version) {
  main(argv, version).catch((err) => {
    console.error(`zgdiff: ${err instanceof Error ? err.message : String(err)}`);
    if (!(err instanceof AppError)) console.error(err);
    process.exit(1);
  });
}
