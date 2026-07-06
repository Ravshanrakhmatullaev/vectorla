import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
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
})
