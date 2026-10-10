import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { dailyThreeDefines, duelEnvDefines } from './buildEnv.ts'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Pages sets build variables in the process environment; a local .env file may set them too.
  const env = { ...loadEnv(mode, process.cwd(), 'VITE_'), ...process.env }
  return {
    plugins: [react()],
    // Playwright's flag-off dev server (playwright.config.ts) keeps its own dependency cache.
    cacheDir: process.env.VITE_CACHE_DIR || 'node_modules/.vite',
    define: {
      // PR preview builds leave duel mode off (buildEnv.ts).
      ...duelEnvDefines(env),
      // Daily Three only with VITE_DAILY_THREE=1 (buildEnv.ts).
      ...dailyThreeDefines(env),
    },
  }
})
