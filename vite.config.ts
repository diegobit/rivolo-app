import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  server: {
    port: 5174,
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico'],
      manifest: {
        name: 'Rivolo',
        short_name: 'Rivolo',
        description: 'Day-block single note PWA',
        theme_color: '#ffffff',
        background_color: '#f8fafc',
        display: 'standalone',
        icons: [
          {
            src: '/favicon.ico',
            sizes: 'any',
            type: 'image/x-icon',
          },
        ],
      },
    }),
  ],
})
