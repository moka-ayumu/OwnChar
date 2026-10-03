import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    {
      name: 'isolate-module-server-cache',
      config(config) {
        // Module servers started by scripts must not replace the running app's optimized dependencies.
        if (config.server?.middlewareMode && !config.cacheDir) {
          return { cacheDir: `node_modules/.vite-ssr/${process.pid}` }
        }
      },
    },
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
  ],
  resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } },
  test: { include: ['tests/unit/**/*.test.ts'] },
})
