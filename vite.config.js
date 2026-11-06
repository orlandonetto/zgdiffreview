import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';

// Em desenvolvimento, rode a CLI (`node bin/zgdiff.js --no-open --port 7420`)
// num repositório e `npm run dev:web` aqui: o Vite repassa /api para a CLI.
export default defineConfig({
  root: fileURLToPath(new URL('./web', import.meta.url)),
  plugins: [vue()],
  build: {
    outDir: fileURLToPath(new URL('./dist/web', import.meta.url)),
    emptyOutDir: true,
  },
  server: {
    proxy: { '/api': { target: 'http://127.0.0.1:7420', changeOrigin: true } },
  },
  test: {
    root: fileURLToPath(new URL('.', import.meta.url)),
    include: ['test/**/*.test.js'],
  },
});
