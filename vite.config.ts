import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { version } from './package.json'

// https://vite.dev/config/
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  server: {
    port: 5174,
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Public files referenced by absolute URLs bypass Vite's module graph, so
      // list them for Workbox to keep the installed app's shell usable offline.
      includeAssets: ['favicon.ico', '**/*.{svg,png,jpg,ttf}'],
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
          {
            src: '/apple-touch-icon.png',
            sizes: '180x180',
            type: 'image/png',
          },
        ],
      },
    }),
  ],
})
