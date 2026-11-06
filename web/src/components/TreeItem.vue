<script setup>
import { computed } from 'vue';
import { store } from '../store.js';
import FileEntry from './FileEntry.vue';

const props = defineProps({
  /** @type {import('vue').PropType<import('../lib/tree.js').TreeNode>} */
  node: { type: Object, required: true },
  depth: { type: Number, required: true },
});

const open = computed(() => props.node.kind === 'dir' && !store.closedDirs.has(props.node.path));

function toggle() {
  if (props.node.kind !== 'dir') return;
  if (store.closedDirs.has(props.node.path)) store.closedDirs.delete(props.node.path);
  else store.closedDirs.add(props.node.path);
}
</script>

<template>
  <li v-if="node.kind === 'dir'" class="tree-dir">
    <button class="tree-dir-label" :style="{ paddingLeft: `${8 + depth * 14}px` }" @click="toggle">
      <span class="tree-caret">{{ open ? '▾' : '▸' }}</span>
      <span class="tree-folder">📁</span>
      <span class="tree-name">{{ node.name }}</span>
    </button>
    <ul v-if="open" class="tree-children">
      <TreeItem v-for="child in node.children" :key="child.path" :node="child" :depth="depth + 1" />
    </ul>
  </li>
  <li v-else>
    <FileEntry :file="node.file" :label="node.name" :indent="22 + depth * 14" />
  </li>
</template>
