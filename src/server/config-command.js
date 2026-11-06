import { createInterface } from 'node:readline';
import { ValidationError } from './errors.js';
import { credentialSource, EFFORTS, ENV_HINT, loadConfig, PROVIDER_LABELS, PROVIDERS, setApiKey, updateConfig, zgdiffHome } from './llm/config.js';

export const CONFIG_HELP = `zgdiff config — configuração do chat (LLM)

  zgdiff config                         mostra a configuração atual
  zgdiff config set provider <p>        provedor padrão: ${PROVIDERS.join(' | ')}
  zgdiff config set model <modelo>      modelo do provedor padrão
  zgdiff config set model.<p> <modelo>  modelo de um provedor específico
  zgdiff config set effort <e>          esforço: ${EFFORTS.join(' | ')}
  zgdiff config set gemini.vertex true  Gemini pelo Vertex AI (login do gcloud, sem chave)
  zgdiff config set gemini.project <id> projeto GCP do Vertex AI
  zgdiff config set gemini.location <r> região do Vertex AI (padrão: global)
  zgdiff config set autoDefinitionFallback true
                                        pergunta à IA sozinho quando ⌘+clique não achar a definição
  zgdiff config set-key <p>             grava a chave de um provedor (pedida sem eco)
  zgdiff config unset-key <p>           apaga a chave gravada

As chaves também podem vir das variáveis ANTHROPIC_API_KEY, OPENAI_API_KEY e
GEMINI_API_KEY (que têm prioridade). Ficam em ${zgdiffHome()}/credentials.json,
legível só pelo seu usuário, e nunca são enviadas ao navegador.
`;

const bool = (v) => {
  if (v === 'true') return true;
  if (v === 'false') return false;
  throw new ValidationError('Use true ou false.');
};

export async function runConfigCommand(args) {
  const [cmd, key, value] = args;
  if (!cmd) return show();
  if (cmd === 'help' || cmd === '--help' || cmd === '-h') {
    process.stdout.write(CONFIG_HELP);
    return;
  }

  if (cmd === 'set') {
    if (!key || value === undefined) throw new ValidationError('Uso: zgdiff config set <chave> <valor>');
    if (key === 'provider') await updateConfig({ provider: value });
    else if (key === 'model') await updateConfig({ model: value });
    else if (key.startsWith('model.')) {
      const p = key.slice('model.'.length);
      if (!PROVIDERS.includes(p)) throw new ValidationError(`Provedor inválido: ${p}`);
      await updateConfig({ model: value, modelProvider: p });
    } else if (key === 'effort') await updateConfig({ effort: value });
    else if (key === 'gemini.vertex') await updateConfig({ gemini: { vertex: bool(value) } });
    else if (key === 'gemini.project') await updateConfig({ gemini: { project: value } });
    else if (key === 'gemini.location') await updateConfig({ gemini: { location: value } });
    else if (key === 'autoDefinitionFallback') await updateConfig({ autoDefinitionFallback: bool(value) });
    else throw new ValidationError(`Chave desconhecida: ${key}. Veja "zgdiff config help".`);
    console.log('Configuração salva.');
    return show();
  }

  if (cmd === 'set-key' || cmd === 'unset-key') {
    if (!PROVIDERS.includes(key)) throw new ValidationError(`Informe o provedor: ${PROVIDERS.join(' | ')}`);
    if (cmd === 'unset-key') {
      await setApiKey(key, null);
      console.log(`Chave de ${PROVIDER_LABELS[key]} apagada.`);
      return;
    }
    const secret = await askHidden(`Chave de ${PROVIDER_LABELS[key]}: `);
    if (!secret.trim()) throw new ValidationError('Nenhuma chave informada.');
    await setApiKey(key, secret.trim());
    console.log(`Chave de ${PROVIDER_LABELS[key]} gravada em ${zgdiffHome()}/credentials.json.`);
    return;
  }

  throw new ValidationError(`Comando desconhecido: ${cmd}. Veja "zgdiff config help".`);
}

async function show() {
  const cfg = await loadConfig();
  console.log(`Provedor padrão: ${PROVIDER_LABELS[cfg.provider]}   ·   esforço: ${cfg.effort}`);
  for (const p of PROVIDERS) {
    const src = await credentialSource(p, cfg);
    console.log(`\n  ${PROVIDER_LABELS[p]}${p === cfg.provider ? '  (padrão)' : ''}`);
    console.log(`    modelo:     ${cfg.models[p] ?? '(escolha no chat ou com "zgdiff config set model.' + p + ' <modelo>")'}`);
    console.log(`    credencial: ${src ?? `não configurada — ${ENV_HINT[p]}`}`);
  }
  if (cfg.gemini.vertex) console.log(`\n  Gemini via Vertex AI: projeto ${cfg.gemini.project ?? '(não definido)'}, região ${cfg.gemini.location}`);
  console.log(`\n  Definição pela IA sem perguntar: ${cfg.autoDefinitionFallback ? 'sim' : 'não'}`);
  console.log(`\nArquivos em ${zgdiffHome()}. Ajuda: zgdiff config help`);
}

/** Lê uma linha do terminal sem mostrar o que é digitado. */
function askHidden(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const write = rl._writeToOutput?.bind(rl);
    rl._writeToOutput = (s) => {
      if (s.startsWith(question)) write?.(s);
      else if (s === '\r\n' || s === '\n') write?.(s);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}
