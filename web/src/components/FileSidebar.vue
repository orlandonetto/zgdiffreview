<script setup>
import { orderedFiles, store, tree } from '../store.js';
import FileEntry from './FileEntry.vue';
import FlowList from './FlowList.vue';
import TreeItem from './TreeItem.vue';
</script>

<template>
  <aside class="sidebar">
    <div class="sidebar-header">
      <span class="sidebar-title">Arquivos ({{ store.review?.files.length ?? 0 }})</span>
      <div class="segmented">
        <button :class="{ active: store.listMode === 'flow' }" title="Ordem de revisão: da entrada da aplicação para dentro" @click="store.listMode = 'flow'">
          Fluxo
        </button>
        <button :class="{ active: store.listMode === 'tree' }" title="Árvore de pastas" @click="store.listMode = 'tree'">Árvore</button>
        <button :class="{ active: store.listMode === 'list' }" title="Lista de caminhos" @click="store.listMode = 'list'">Lista</button>
      </div>
    </div>
    <FlowList v-if="store.listMode === 'flow'" />
    <ul v-else-if="store.listMode === 'tree'" class="file-list">
      <TreeItem v-for="node in tree" :key="node.path" :node="node" :depth="0" />
    </ul>
    <ul v-else class="file-list">
      <li v-for="file in orderedFiles" :key="file.path">
        <FileEntry :file="file" :label="file.path" :indent="10" />
      </li>
    </ul>
  </aside>
</template>
