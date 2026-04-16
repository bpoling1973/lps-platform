import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  server: {
    host: true, // expose on local network so tablets/phones can connect
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png'],
      manifest: {
        name: 'OpSolv LPS Platform',
        short_name: 'OpSolv LPS',
        description: 'Last Planner System collaborative planning platform',
        theme_color: '#1e3a5f',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'landscape',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024, // 4 MiB
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*\.supabase\.co\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase-cache',
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: { '@': '/src' },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('@react-pdf')) return 'vendor-pdf'
          if (id.includes('recharts')) return 'vendor-charts'
          if (id.includes('@dnd-kit')) return 'vendor-dnd'
          if (id.includes('@supabase')) return 'vendor-supabase'
          if (id.includes('react-router') || id.includes('react-dom') || (id.includes('node_modules/react/') && !id.includes('react-dom'))) return 'vendor-react'
          if (id.includes('@tanstack') || id.includes('zustand')) return 'vendor-query'
        },
      },
    },
  },
})
