import react from '@vitejs/plugin-react'
import { defineConfig, type UserConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const config: UserConfig = {
    plugins: [react()],
    build: {
      sourcemap: false,
    },
  }
  if (mode === 'production') {
    // Forwarded to esbuild during transform; Vite 8’s bundled `ESBuildOptions`
    // type omits `drop` (Rolldown-related typings) — still applied at build time.
    config.esbuild = { drop: ['console', 'debugger'] } as NonNullable<
      UserConfig['esbuild']
    >
  }
  return config
})
