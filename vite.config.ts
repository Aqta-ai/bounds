import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['logo.svg', 'logo.png', 'icons/*.png'],
      manifest: {
        name: 'Bounds — Private PDF Redaction',
        short_name: 'Bounds',
        description: 'Zero-trust PDF PII redaction. Everything runs in your browser. Nothing leaves your device.',
        theme_color: '#009B72',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Don't precache large ML models or WASM binaries — they're fetched on demand
        globPatterns: ['**/*.{js,mjs,css,html,ico,png,svg,woff2}'],
        globIgnores: ['**/ort-wasm*', '**/onnx*', '**/*.wasm'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // 5 MB
      },
    }),
  ],
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    exclude: ['@xenova/transformers', 'tesseract.js'],
  },
  server: {
    headers: {
      // Required for SharedArrayBuffer (used by WASM threads in Tesseract and Transformers.js)
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
  build: {
    target: 'es2020',
    rollupOptions: {
      input: {
        main: './index.html',
        demo: './demo.html',
      },
    },
  },
})
