import { existsSync } from 'node:fs';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ValidationError } from '../errors.js';

export const PROVIDERS = ['anthropic', 'openai', 'gemini'];
export const PROVIDER_LABELS = { anthropic: 'Anthropic (Claude)', openai: 'OpenAI', gemini: 'Google Gemini' };
export const EFFORTS = ['low', 'medium', 'high'];

/** Modelo padrão por provedor. OpenAI e Gemini: escolhido na lista do próprio provedor. */
export const DEFAULT_MODELS = { anthropic: 'claude-sonnet-5-5', openai: null, gemini: null };

const ENV_KEYS = {
  anthropic: ['ANTHROPIC_API_KEY'],
  openai: ['OPENAI_API_KEY'],
  gemini: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
};

export function zgdiffHome() {
  return process.env.ZGDIFF_HOME ?? join(homedir(), '.zgdiff');
}

const configPath = () => join(zgdiffHome(), 'config.json');
const credentialsPath = () => join(zgdiffHome(), 'credentials.json');

/**
 * @typedef {object} LlmConfig
 * @property {'anthropic' | 'openai' | 'gemini'} provider
 * @property {Record<string, string | null>} models
 * @property {'low' | 'medium' | 'high'} effort
 * @property {{ vertex: boolean, project: string | null, location: string }} gemini
 * @property {boolean} autoDefinitionFallback
 */

/** @returns {LlmConfig} */
function defaults() {
  return {
    provider: 'anthropic',
    models: { ...DEFAULT_MODELS },
    effort: 'medium',
    gemini: { vertex: false, project: null, location: 'global' },
    autoDefinitionFallback: false,
  };
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    throw new ValidationError(`Não consegui ler ${path}: ${err.message}`);
  }
}

async function writeJson(path, data, mode) {
  await mkdir(zgdiffHome(), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2), { encoding: 'utf8', mode });
  await rename(tmp, path);
  if (mode) await chmod(path, mode);
}

/** @returns {Promise<LlmConfig>} */
export async function loadConfig() {
  const raw = (await readJson(configPath())).llm ?? {};
  const cfg = defaults();
  if (PROVIDERS.includes(raw.provider)) cfg.provider = raw.provider;
  for (const p of PROVIDERS) if (typeof raw.models?.[p] === 'string' && raw.models[p]) cfg.models[p] = raw.models[p];
  if (EFFORTS.includes(raw.effort)) cfg.effort = raw.effort;
  if (raw.gemini && typeof raw.gemini === 'object') {
    cfg.gemini.vertex = raw.gemini.vertex === true;
    if (typeof raw.gemini.project === 'string') cfg.gemini.project = raw.gemini.project;
    if (typeof raw.gemini.location === 'string' && raw.gemini.location) cfg.gemini.location = raw.gemini.location;
  }
  cfg.autoDefinitionFallback = raw.autoDefinitionFallback === true;
  return cfg;
}

/** Aplica mudanças validadas e grava. */
export async function updateConfig(patch) {
  const cfg = await loadConfig();
  if (patch.provider !== undefined) {
    if (!PROVIDERS.includes(patch.provider)) throw new ValidationError(`Provedor inválido: ${patch.provider}`);
    cfg.provider = patch.provider;
  }
  if (patch.model !== undefined) {
    if (typeof patch.model !== 'string' || !/^[\w.:/@-]{1,120}$/.test(patch.model)) throw new ValidationError('Nome de modelo inválido.');
    cfg.models[patch.modelProvider ?? cfg.provider] = patch.model;
  }
  if (patch.effort !== undefined) {
    if (!EFFORTS.includes(patch.effort)) throw new ValidationError(`Esforço inválido (use ${EFFORTS.join(', ')}).`);
    cfg.effort = patch.effort;
  }
  if (patch.autoDefinitionFallback !== undefined) cfg.autoDefinitionFallback = patch.autoDefinitionFallback === true;
  if (patch.gemini) {
    if (patch.gemini.vertex !== undefined) cfg.gemini.vertex = patch.gemini.vertex === true;
    if (patch.gemini.project !== undefined) cfg.gemini.project = String(patch.gemini.project) || null;
    if (patch.gemini.location !== undefined) cfg.gemini.location = String(patch.gemini.location) || 'global';
  }
  const file = await readJson(configPath());
  await writeJson(configPath(), { ...file, llm: cfg });
  return cfg;
}

/** Chave de um provedor: variável de ambiente primeiro, depois ~/.zgdiff/credentials.json. */
export async function getApiKey(provider) {
  for (const name of ENV_KEYS[provider] ?? []) if (process.env[name]) return process.env[name];
  const creds = await readJson(credentialsPath());
  return typeof creds[provider] === 'string' && creds[provider] ? creds[provider] : null;
}

export async function setApiKey(provider, key) {
  if (!PROVIDERS.includes(provider)) throw new ValidationError(`Provedor inválido: ${provider}`);
  const creds = await readJson(credentialsPath());
  if (key) creds[provider] = key;
  else delete creds[provider];
  await writeJson(credentialsPath(), creds, 0o600);
}

/** Origem da credencial (sem revelar a chave). */
export async function credentialSource(provider, cfg) {
  for (const name of ENV_KEYS[provider] ?? []) if (process.env[name]) return `variável ${name}`;
  const creds = await readJson(credentialsPath());
  if (creds[provider]) return '~/.zgdiff/credentials.json';
  if (provider === 'gemini' && cfg.gemini.vertex && cfg.gemini.project) return `Vertex AI (${cfg.gemini.project}, login do gcloud)`;
  if (provider === 'anthropic' && (process.env.ANTHROPIC_AUTH_TOKEN || existsSync(join(homedir(), '.config', 'anthropic')))) {
    return 'perfil do `ant auth login`';
  }
  return null;
}

export const ENV_HINT = {
  anthropic: 'export ANTHROPIC_API_KEY=...  (ou: zgdiff config set-key anthropic)',
  openai: 'export OPENAI_API_KEY=...  (ou: zgdiff config set-key openai)',
  gemini: 'export GEMINI_API_KEY=...  (ou: zgdiff config set-key gemini; para Vertex AI: zgdiff config set gemini.vertex true e gemini.project <projeto>)',
};
