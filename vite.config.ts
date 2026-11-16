import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'path';
import {defineConfig} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';

function protectUploadedAssets() {
  return {
    name: 'protect-uploaded-assets',
    configureServer(server: { middlewares: { use: (fn: (req: { url?: string }, res: { statusCode: number; end: (s: string) => void }, next: () => void) => void) => void } }) {
      server.middlewares.use((req, res, next) => {
        if (req.url && req.url.includes('/assets/aistudio')) {
          res.statusCode = 404;
          res.end('Not found');
          return;
        }
        next();
      });
    },
    configurePreviewServer(server: { middlewares: { use: (fn: (req: { url?: string }, res: { statusCode: number; end: (s: string) => void }, next: () => void) => void) => void } }) {
      server.middlewares.use((req, res, next) => {
        if (req.url && req.url.includes('/assets/aistudio')) {
          res.statusCode = 404;
          res.end('Not found');
          return;
        }
        next();
      });
    },
    closeBundle() {
      const target = path.resolve(__dirname, 'dist', 'assets', 'aistudio');
      if (fs.existsSync(target)) {
        fs.rmSync(target, { recursive: true, force: true });
      }
    },
  };
}

function devManifestMiddleware(manifestObj: Record<string, unknown>) {
  return {
    name: 'dev-manifest-middleware',
    apply: 'serve' as const,
    configureServer(server: { middlewares: { use: (fn: (req: { url?: string }, res: { statusCode: number; setHeader: (k: string, v: string) => void; end: (s: string) => void }, next: () => void) => void) => void } }) {
      server.middlewares.use((req, res, next) => {
        const cleanUrl = (req.url || '').split('?')[0];
        if (cleanUrl === '/manifest.webmanifest') {
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
          res.setHeader('Cache-Control', 'no-cache');
          res.end(JSON.stringify(manifestObj));
          return;
        }
        next();
      });
    },
    transformIndexHtml(html: string) {
      if (html.includes('rel="manifest"')) return html;
      return html.replace('</head>', '  <link rel="manifest" href="./manifest.webmanifest">\n</head>');
    },
  };
}

export default defineConfig(() => {
  const pwaManifest = {
    id: './',
    name: 'İnönü Tıp Dönem I Ders Programı',
    short_name: 'İnönü Tıp D1',
    description: 'İnönü Üniversitesi Tıp Fakültesi Dönem I (2026-2027) Türkçe ve İngilizce Ders Programı',
    lang: 'tr',
    theme_color: '#070d19',
    background_color: '#070d19',
    display: 'standalone' as const,
    start_url: './',
    scope: './',
    icons: [
      {
        src: './pwa-192x192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: './pwa-512x512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: './pwa-maskable-512x512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };

  return {
    base: './',
    plugins: [
      protectUploadedAssets(),
      devManifestMiddleware(pwaManifest),
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.png', 'apple-touch-icon.png', 'pwa-192x192.png', 'pwa-512x512.png', 'pwa-maskable-512x512.png'],
        manifest: pwaManifest,
        workbox: {
          globPatterns: ['**/*.{js,mjs,css,html,ico,png,svg,woff,woff2}'],
          globIgnores: ['**/aistudio/**'],
          maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
          navigateFallbackDenylist: [/^\/api\//],
          runtimeCaching: [
            {
              urlPattern: /^\/api\/.*/i,
              handler: 'NetworkOnly',
            },
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'gstatic-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^https:\/\/panel\.inonu\.edu\.tr\/servlet\/food.*/i,
              handler: 'NetworkFirst',
              options: {
                cacheName: 'inonu-food-api-cache',
                networkTimeoutSeconds: 6,
                expiration: {
                  maxEntries: 40,
                  maxAgeSeconds: 60 * 60 * 24 * 7,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
            {
              urlPattern: /^https:\/\/panel\.inonu\.edu\.tr\/servlet\/image\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'inonu-food-images-cache',
                expiration: {
                  maxEntries: 150,
                  maxAgeSeconds: 60 * 60 * 24 * 30,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
          ],
        },
        devOptions: {
          enabled: false,
          type: 'module',
        },
      }),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
