import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { AppError, NotFoundError, ValidationError } from './errors.js';
import { computeReview, fileLines } from './git.js';
import { createFeatures } from './features.js';
import { commentsToMarkdown } from './markdown.js';

/** @typedef {import('../shared/types.js').ReviewInfo} ReviewInfo */
/** @typedef {import('./store.js').ReviewStore} ReviewStore */

const MAX_BODY = 1024 * 1024;
const MAX_COMMENT = 20_000;
const MAX_SNIPPET = 200_000;

/** Cabeçalho que a interface envia nas rotas que alteram estado. */
export const CLIENT_HEADER = 'x-zgdiff';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
};

/**
 * @param {{ root: string, base: string, head: string, store: ReviewStore, webDir: string }} opts
 */
export function createReviewServer(opts) {
  let port = 0;
  /** Último review calculado: define quais arquivos/commits a API aceita servir. @type {ReviewInfo | null} */
  let last = null;

  const current = async () => last ?? (last = await computeReview(opts.root, opts.base, opts.head));
  const features = createFeatures({ root: opts.root, store: opts.store, current, json, readJson });

  const handleApi = async (req, url, res) => {
    const method = req.method ?? 'GET';
    const path = url.pathname;

    if (method === 'GET' && path === '/api/review') {
      // Recalcula a cada carga da página: novos commits na branch aparecem ao recarregar.
      last = await computeReview(opts.root, opts.base, opts.head);
      features.onReview(last);
      return json(res, 200, { review: last, state: opts.store.get(), storePath: opts.store.path });
    }

    if (await features.read(method, path, url, res)) return;

    if (method === 'GET' && path === '/api/file') {
      const review = await current();
      const side = parseSide(url.searchParams.get('side'));
      const file = findFile(review, url.searchParams.get('path'));
      const filePath = side === 'new' ? file.newPath : file.oldPath;
      if (!filePath) throw new ValidationError('Este lado do arquivo não existe.');
      const sha = side === 'new' ? review.headSha : review.mergeBaseSha;
      return json(res, 200, { lines: await fileLines(opts.root, sha, filePath) });
    }

    if (method === 'GET' && path === '/api/export.md') {
      const md = commentsToMarkdown(await current(), opts.store.get().comments);
      res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8' });
      res.end(md);
      return;
    }

    // Rotas que alteram estado exigem o cabeçalho próprio da interface. Um site de fora
    // não consegue enviá-lo sem um preflight de CORS, que este servidor nunca aprova.
    if (req.headers[CLIENT_HEADER] !== '1') throw new AppError('Requisição recusada.', 403);

    if (method === 'PUT' && path === '/api/viewed') {
      const body = await readJson(req);
      const file = findFile(await current(), body.path);
      if (typeof body.viewed !== 'boolean') throw new ValidationError('"viewed" deve ser booleano.');
      await opts.store.setViewed(file.path, body.viewed ? file.patchHash : null);
      return json(res, 200, { state: opts.store.get() });
    }

    if (method === 'POST' && path === '/api/comments') {
      const input = parseNewComment(await readJson(req));
      findFile(await current(), input.path);
      const comment = await opts.store.addComment(input);
      return json(res, 201, { comment });
    }

    if (await features.write(method, path, req, res)) return;

    const m = /^\/api\/comments\/([\w-]{1,64})$/.exec(path);
    if (m && method === 'PATCH') {
      const body = await readJson(req);
      const comment = await opts.store.updateComment(m[1], parseBody(body.body));
      return json(res, 200, { comment });
    }
    if (m && method === 'DELETE') {
      await opts.store.deleteComment(m[1]);
      res.writeHead(204).end();
      return;
    }

    throw new NotFoundError('Rota não encontrada.');
  };

  const handleStatic = async (url, res) => {
    const root = resolve(opts.webDir);
    let decoded;
    try {
      decoded = decodeURIComponent(url.pathname);
    } catch {
      throw new NotFoundError('Arquivo não encontrado.');
    }
    let target = resolve(join(root, normalize(decoded)));
    if (target !== root && !target.startsWith(root + sep)) throw new NotFoundError('Arquivo não encontrado.');
    if (target === root || !extname(target)) target = join(root, 'index.html');
    try {
      const data = await readFile(target);
      res.writeHead(200, { 'content-type': MIME[extname(target)] ?? 'application/octet-stream' });
      res.end(data);
    } catch {
      throw new NotFoundError('Arquivo não encontrado.');
    }
  };

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const run = async () => {
      // Bloqueia DNS rebinding: só aceita Host apontando para esta máquina.
      const host = req.headers.host ?? '';
      if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) throw new AppError('Host não permitido.', 403);
      if (url.pathname.startsWith('/api/')) await handleApi(req, url, res);
      else await handleStatic(url, res);
    };
    run().catch((err) => {
      const status = err instanceof AppError ? err.status : 500;
      const message = err instanceof Error ? err.message : String(err);
      if (status >= 500) console.error(err);
      if (!res.headersSent) json(res, status, { error: message });
      else res.end();
    });
  });

  return {
    server,
    setPort: (p) => (port = p),
    init: () => features.init(),
    close: () => features.close(),
  };
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  if (!String(req.headers['content-type'] ?? '').startsWith('application/json')) {
    throw new ValidationError('Envie JSON (content-type: application/json).');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new ValidationError('Corpo da requisição grande demais.');
    chunks.push(chunk);
  }
  let parsed;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ValidationError('JSON inválido.');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new ValidationError('JSON inválido.');
  return parsed;
}

function findFile(review, path) {
  if (typeof path !== 'string' || !path) throw new ValidationError('"path" é obrigatório.');
  const file = review.files.find((f) => f.path === path);
  if (!file) throw new NotFoundError(`Arquivo fora do diff: ${path}`);
  return file;
}

function parseSide(v) {
  if (v !== 'old' && v !== 'new') throw new ValidationError('"side" deve ser "old" ou "new".');
  return v;
}

function parseBody(v) {
  if (typeof v !== 'string' || !v.trim()) throw new ValidationError('O comentário não pode ficar vazio.');
  if (v.length > MAX_COMMENT) throw new ValidationError('Comentário grande demais.');
  return v;
}

function parseLine(v, name) {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) throw new ValidationError(`"${name}" deve ser um inteiro positivo.`);
  return v;
}

function parseNewComment(b) {
  const startLine = parseLine(b.startLine, 'startLine');
  const endLine = parseLine(b.endLine, 'endLine');
  if (endLine < startLine) throw new ValidationError('"endLine" não pode ser menor que "startLine".');
  if (typeof b.path !== 'string') throw new ValidationError('"path" é obrigatório.');
  const snippet = typeof b.snippet === 'string' ? b.snippet : '';
  if (snippet.length > MAX_SNIPPET) throw new ValidationError('Trecho grande demais.');
  return { path: b.path, side: parseSide(b.side), startLine, endLine, snippet, body: parseBody(b.body) };
}
