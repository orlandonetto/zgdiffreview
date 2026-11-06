import { h } from 'vue';

/**
 * Conteúdo de uma linha de código: texto puro ou tokens coloridos.
 * Componente funcional (sem estado), porque aparece em cada linha do diff.
 */
export default function CodeText(props) {
  if (!props.parts) return h('span', { class: 'text' }, props.content);
  return h(
    'span',
    { class: 'text' },
    props.parts.map(([text, style]) => (style ? h('span', { style }, text) : text)),
  );
}

CodeText.props = {
  content: { type: String, required: true },
  /** [[texto, estilo], ...] vindos de lib/highlight.js; null = sem cores. */
  parts: { type: Array, default: null },
};
