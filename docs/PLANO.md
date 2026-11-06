# Plano do zgdiff

Decisões tomadas e escopo de cada fase. Atualize o status quando uma fase mudar.

| Fase | Escopo | Status |
|---|---|---|
| 0 | Review básico: diff agrupado, visto, recolher/abrir, árvore/lista, comentários, contexto, export, pacote npm em JS | feito |
| 1 | Modo Fluxo (ordem de revisão) | feito |
| 2 | Ir para a definição (⌘/Ctrl+clique) | feito |
| 3 | Chat com LLM (OpenAI, Anthropic, Gemini), ferramentas de leitura | feito |
| 4 | Chat com ações: sugerir comentários e ordem, descrição da PR, definição via IA | feito |
| 5 | Opcional: "Ver referências"; Claude via Vertex AI | pendente |

## Decisões

- Todo o código do projeto é JavaScript (ES modules). O pacote `typescript` entra só como
  biblioteca, para o "ir para a definição" preciso. Fixado na série 6.x: a 7.x (reescrita em Go)
  ainda não tem a API de language service estável.
- Pacote npm `zgdiff`, comando `zgdiff <base> <branch>`.
- LLM: os três SDKs oficiais (`@anthropic-ai/sdk`, `openai`, `@google/genai`). Padrão: Anthropic
  com `claude-sonnet-5-5`. Para OpenAI e Gemini o modelo é escolhido da lista do próprio provedor
  (não fixamos nomes que envelhecem). Gemini também aceita Vertex AI (login do `gcloud`).
- Chaves só no servidor local: variáveis de ambiente ou `~/.zgdiff/credentials.json` (permissão
  0600) gravado por `zgdiff config set-key`. Nunca passam pelo navegador.
- O chat vem desligado: nada é enviado até você mandar uma mensagem; a tela mostra o provedor.
- A IA nunca grava sozinha: comentários e ordem sugeridos só entram se você aceitar.
- Testes aparecem no Fluxo logo depois do arquivo que testam, com chave "junto | no fim".
- Ir para a definição em cascata: language service do TypeScript → heurística própria →
  IA (só com confirmação, a menos que `llm.autoDefinitionFallback` esteja ligado).

## Fase 1: Fluxo

- Entradas: `.zgdiff.json` (`entry`), `package.json` (`main`, `bin`, scripts `start`/`dev`/`serve`)
  de cada pacote do repositório, e nomes convencionais (`server`, `index`, `main`, `app`) na raiz
  ou em `src/`.
- Grafo de imports dos arquivos JS/TS/Vue na ponta da branch (`import`, `export … from`,
  `import()`, `require`), resolvendo extensões, `index.*`, `@/` → `src/` e `aliases` do `.zgdiff.json`.
- Ordem: distância até a entrada, desempate por camada e caminho. Sem grafo, só camadas.
- Camadas padrão: entrada → app → config/middlewares → rotas → validação → controllers →
  services → DAO/repositórios → models/tipos → helpers/utils (e o equivalente no frontend:
  main → App → router → páginas → layouts → componentes → stores/composables → api).
- Grupos no fim: Testes sem par, Configuração e build, Outros.
- Tela: modo Fluxo no painel (numerado, com camada), "como se chega aqui" no cabeçalho do arquivo,
  atalhos `n`/`p` (próximo/anterior), `v` (visto e próximo não visto), botão "Próximo não visto".

## Fase 2: Ir para a definição

- ⌘+clique (Mac) / Ctrl+clique (Windows/Linux), com sublinhado ao segurar a tecla.
- Lado esquerdo procura na base; direito, na branch; no unificado, conforme o tipo da linha.
- Destino num arquivo do diff: rola, expande o trecho oculto se preciso e destaca a linha.
  Fora do diff: visualizador de arquivo (só leitura, com ⌘+clique dentro).
  Vários resultados: lista para escolher. Voltar: Alt+← / Ctrl+− e botão "← Voltar".
- Rotas de arquivo só servem arquivos versionados nos dois commits do review.

## Fases 3 e 4: Chat

- Camada de adaptação: formato interno único de mensagens e ferramentas; um adaptador por provedor.
- Ferramentas: `list_changed_files`, `get_review_flow`, `get_file_diff`, `get_file_content`,
  `search_code`, `find_definition`, `get_review_comments`, `propose_comment`, `propose_order`,
  `show_location`.
- Streaming para a tela (SSE), histórico salvo por review em `~/.zgdiff/reviews/*.chat.json`.
- Atalhos: "Ordem de revisão", "Resumir mudanças", "Descrição da PR", "Revisar arquivo atual",
  e "Perguntar à IA" na seleção de código.
