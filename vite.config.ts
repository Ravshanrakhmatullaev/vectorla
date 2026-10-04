import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { securityHeaders } from './scripts/securityHeaders.ts'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), securityHeaders({ ...loadEnv(mode, process.cwd(), ''), ...process.env } as Record<string, string>, mode)],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Vendor code changes far less often than app code — splitting it out
        // lets browsers cache it across deploys instead of re-downloading it
        // every time app code changes.
        manualChunks(id) {
          if (id.includes('node_modules/framer-motion')) return 'motion'
          if (id.includes('node_modules/react')) return 'vendor'
        },
      },
    },
  },
}))
