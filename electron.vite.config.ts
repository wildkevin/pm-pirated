import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: { index: resolve('src/main/index.ts'), engine: resolve('src/engine/main.ts'), mocks: resolve('src/mocks/main.ts'), proxy: resolve('src/proxy/main.ts'), loadtest: resolve('src/loadtest/main.ts') },
      },
    },
  },
  preload: {
    build: { rollupOptions: { input: { index: resolve('src/preload/index.ts') } } },
  },
  renderer: {
    root: 'src/renderer',
    build: { rollupOptions: { input: resolve('src/renderer/index.html') } },
    plugins: [react()],
  },
})
