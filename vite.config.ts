import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      devOptions: { enabled: false },
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
        globIgnores: ['**/ort-wasm*', '**/onnx*', '**/*.wasm', '**/tesseract-core*.js'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024, // 5 MB
        // Runtime caching for large assets excluded from precache.
        // CacheFirst: serve from cache if present, fetch and cache on first use.
        // These files are immutable (content-hashed or versioned) so a 1-year TTL is safe.
        runtimeCaching: [
          {
            // Tesseract WASM core + worker script + language data
            urlPattern: /\/(tesseract-worker\.min\.js|tesseract-core.*\.js|.*\.traineddata(\.gz)?)(\?.*)?$/,
            handler: 'CacheFirst' as const,
            options: {
              cacheName: 'tesseract-assets',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
          {
            // Face-api TinyFaceDetector model files (~190 KB total)
            urlPattern: /\/models\/face-api\//,
            handler: 'CacheFirst' as const,
            options: {
              cacheName: 'face-api-models',
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
          {
            // ONNX Runtime WASM binaries served from jsDelivr CDN.
            // These are required by @xenova/transformers for NER and Explain
            // workers — without caching, offline use fails even after first load.
            urlPattern: /https:\/\/cdn\.jsdelivr\.net\/npm\/onnxruntime-web.*\.(wasm|js)(\?.*)?$/,
            handler: 'CacheFirst' as const,
            options: {
              cacheName: 'onnx-runtime',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
          {
            // UltraFace-320 ONNX model for face detection (~1.2 MB, served locally).
            // Excluded from precache by globIgnores, so must be runtime-cached.
            urlPattern: /\/ultraface-320\.onnx(\?.*)?$/,
            handler: 'CacheFirst' as const,
            options: {
              cacheName: 'face-detection-model',
              expiration: { maxEntries: 2, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
        ],
      },
    }),
  ],
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    // @xenova/transformers is pure ESM — no pre-bundling needed.
    // onnxruntime-web must NOT be excluded: its dist/ort-web.min.js is a
    // webpack UMD bundle that crashes when served raw as an ES module
    // (registerBackend is called before the ORT namespace is assigned).
    // Letting Vite pre-bundle it converts it to proper ESM first.
    exclude: ['@xenova/transformers'],
    include: ['tesseract.js', 'onnxruntime-web'],
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
      },
    },
  },
  test: {
    environment: 'happy-dom',
  },
})
