import { defineConfig } from 'vite'
import baseConfig from './vite.config'

// Report and memory edits must not reload an acceptance journey in progress.
export default defineConfig(async configEnv => {
  const base = await baseConfig(configEnv)

  return {
    ...base,
    server: {
      ...base.server,
      watch: null,
      hmr: false,
    },
  }
})
