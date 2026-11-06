# zgdiff

Review local de uma branch no navegador, no estilo da aba "Files changed" do GitHub/Bitbucket:
todas as mudanças da branch agrupadas (não commit a commit), comparadas com o ponto onde ela
saiu da base. É o mesmo que `git diff base...branch` e o mesmo que a PR mostraria.

## Instalação

Precisa de Node.js 20 ou mais novo e do `git` no PATH.

```bash
npm install -g zgdiff
# ou
yarn global add zgdiff
# ou
pnpm add -g zgdiff
```

Também dá para rodar sem instalar: `npx zgdiff develop feature/x` (ou `yarn dlx zgdiff ...`, `pnpm dlx zgdiff ...`).

## Uso

Dentro de qualquer repositório git:

```bash
zgdiff develop feature/teste1      # feature/teste1 comparada com develop
zgdiff develop                     # branch atual comparada com develop
zgdiff                             # branch atual comparada com a base padrão
zgdiff main origin/feature/x -f    # faz git fetch antes e compara com main
zgdiff --help
```

A ordem é sempre `zgdiff <base> <branch>`: primeiro a branch de destino da PR, depois a branch
que vai entrar nela.

Sem base, o zgdiff usa a primeira que existir entre `origin/develop`, `develop`,
`origin/main`, `main`, `origin/master`, `master`.

Opções:

| Opção | O que faz |
|---|---|
| `-f`, `--fetch` | roda `git fetch origin` antes de comparar |
| `-p`, `--port <n>` | porta local (padrão 7420, ou a próxima livre) |
| `--no-open` | não abre o navegador |
| `-v`, `--version` | mostra a versão |

## O que a tela tem

- **Lado a lado ou unificado**, trocando no topo.
- **Painel de arquivos em Fluxo, árvore ou lista.**
- **Visto** por arquivo, com progresso no topo. Marcar recolhe o arquivo. Se o arquivo mudar na
  branch depois, o visto cai e aparece "Mudou desde que você viu".
- **Recolher todos / Abrir todos**, e recolher arquivo por arquivo.
- **Contexto**: em cada trecho oculto, ↑/↓ mostram 20 linhas por vez e "Mostrar todas" revela o
  trecho inteiro. "Ver arquivo inteiro" no cabeçalho mostra o arquivo todo (e "Voltar ao diff").
- **Comentários**: clique ou arraste pelos números de linha, ou selecione um trecho e clique em
  "💬 Comentar". ⌘+Enter salva, Esc cancela. "Exportar" gera Markdown para copiar ou baixar.
- **⟳** recalcula o diff (pega commits novos da branch sem reiniciar).

### Modo Fluxo (ordem de revisão)

Ordena os arquivos como a aplicação executa: da entrada (`server.js`, `main.js`...) para dentro
(app → rotas → controllers → services → dados → utils).

- A entrada vem do `package.json` (scripts `start`/`dev`/`serve`, `main`, `bin`), do `index.html`
  do Vite ou de nomes convencionais. Em monorepos, de cada pacote.
- A ordem segue o grafo de imports (`import`, `require`, `import()`, `export ... from`, alias `@/`).
  O cabeçalho de cada arquivo mostra **como se chega até ele** (`server.js → app.js → routes/...`).
- Testes aparecem logo depois do arquivo que testam (ou todos no fim, pela chave "Testes").
- Arquivos fora do grafo, configuração e o resto ficam em grupos no fim.
- O assistente pode sugerir outra ordem ("Fluxo (IA)"), que só vale se você aceitar.

Para ajustar por repositório, crie um `.zgdiff.json` na raiz:

```json
{
  "entry": ["src/server.js"],
  "aliases": { "#lib/": "src/lib/" },
  "layers": ["routes", "controllers", "services", "dao"]
}
```

### Ir para a definição

**⌘+clique** (Mac) ou **Ctrl+clique** (Windows/Linux) num nome leva até onde ele é definido. Segurando
a tecla, o nome fica sublinhado.

- Lado esquerdo procura na base; lado direito, na branch.
- Definição num arquivo do diff: rola até lá, expande o trecho oculto se preciso e destaca a linha.
  Fora do diff: abre o visualizador de arquivo (onde ⌘+clique continua funcionando).
- Vários resultados: aparece uma lista para escolher.
- **Voltar**: Alt+← (Windows/Linux), ⌃− (Mac) ou o botão "← Voltar".
- A busca é em cascata: primeiro o mesmo mecanismo do VS Code (language service do TypeScript, que
  também entende JavaScript e o `<script>` de arquivos `.vue`), depois uma busca por declarações e,
  se nada achar, a opção de perguntar ao assistente.

### Atalhos

| Tecla | O que faz |
|---|---|
| `n` / `p` | próximo / anterior arquivo, na ordem do painel |
| `v` | marca o arquivo atual como visto e vai ao próximo não visto |
| ⌘/Ctrl+clique | ir para a definição |
| Alt+← / ⌃− | voltar |
| Esc | fecha visualizador e popups |

### Assistente (chat com IA)

O botão **✨ Chat** abre um painel com um assistente que lê os diffs e os arquivos do repositório
para responder. Funciona com **Anthropic (Claude)**, **OpenAI** e **Google Gemini**; o padrão é
Claude Sonnet 5.5.

- Atalhos: "Ordem de revisão", "Resumir mudanças", "Descrição da PR", "Revisar arquivo atual".
- Selecione um trecho de código e clique em "✨ Perguntar à IA" para perguntar sobre ele.
- O assistente pode **sugerir comentários** e **sugerir uma ordem de revisão**; nada entra no review
  sem você clicar em aceitar. Links `arquivo:linha` nas respostas levam direto ao código.
- A conversa fica salva por review, ao lado dos comentários.
- Nada é enviado até você mandar uma mensagem. As mensagens e os trechos de código que o assistente
  ler vão para o provedor escolhido.

Configuração (as chaves ficam só no seu computador e nunca passam pelo navegador):

```bash
export ANTHROPIC_API_KEY=...        # ou: zgdiff config set-key anthropic
export OPENAI_API_KEY=...           # ou: zgdiff config set-key openai
export GEMINI_API_KEY=...           # ou: zgdiff config set-key gemini

zgdiff config                       # mostra a configuração
zgdiff config set provider openai   # provedor padrão
zgdiff config set model.openai <modelo>
zgdiff config set effort low        # low | medium | high
zgdiff config set gemini.vertex true && zgdiff config set gemini.project <projeto>   # Gemini pelo Vertex AI
zgdiff config help
```

Provedor, modelo e esforço também podem ser trocados no próprio painel. Para OpenAI e Gemini a lista
de modelos vem do provedor.

### Onde ficam os dados

Comentários, vistos e a conversa do chat ficam em `~/.zgdiff/reviews/`, por repositório + branch +
base, e reaparecem quando você abre o mesmo review de novo. Configuração e chaves ficam em
`~/.zgdiff/`. A pasta pode ser trocada com a variável de ambiente `ZGDIFF_HOME`.

## Segurança

O servidor escuta só em `127.0.0.1`, recusa requisições com `Host` de fora (DNS rebinding) e só
aceita alterações com um cabeçalho próprio da interface, que outro site não consegue enviar. A API
só serve arquivos versionados nos dois commits do review.

## Desenvolvimento

Todo o código é JavaScript (ES modules), sem etapa de compilação no servidor. O único build é o da
interface (Vue 3 + Vite), que gera `dist/web`. O pacote `typescript` é usado só como biblioteca, para o
"ir para a definição" (fixado na 6.x, que tem a API de language service estável). O plano e as
decisões estão em [docs/PLANO.md](docs/PLANO.md).

```bash
npm install
npm run build        # gera dist/web
npm test             # Vitest: diff, linhas, árvore, CLI, Fluxo, definição e chat (com provedor falso)
npm link             # deixa o comando `zgdiff` deste checkout disponível no sistema

# interface com hot reload: suba a CLI na porta 7420 num repo e rode o Vite aqui
node /caminho/do/zgdiff/bin/zgdiff.js develop minha-branch --no-open --port 7420   # dentro do repo
npm run dev:web
```

Estrutura:

```
bin/zgdiff.js   executável da CLI
src/shared/     parser de diff, ordem do Fluxo e formatos de dados (usados pelo servidor e pela interface)
src/server/     CLI, git, servidor HTTP (node:http), armazenamento, export
  flow/         modo Fluxo: entradas, grafo de imports, camadas
  definition/   ir para a definição: TypeScript language service + heurística
  llm/          chat: configuração, adaptadores (Anthropic, OpenAI, Gemini), ferramentas
web/            interface Vue 3 + Vite (o build vai para dist/web e é servido pela CLI)
test/           testes Vitest
```

Dependências em tempo de execução: os SDKs da Anthropic, OpenAI e Google e o `typescript`, carregados só quando o recurso é usado. Vue e Vite só entram no build.

## Publicar

```bash
npm version patch    # ou minor / major
npm publish          # o prepack roda o build antes de empacotar
```

Para conferir o que vai no pacote antes: `npm pack --dry-run`.
