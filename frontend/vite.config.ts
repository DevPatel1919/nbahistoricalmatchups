import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { duelEnvDefines } from './buildEnv.ts'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // PR preview builds leave duel mode off (buildEnv.ts).
  define: duelEnvDefines(process.env),
})
