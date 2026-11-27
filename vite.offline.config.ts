import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Bundles CSS, JS, JSON data, and `public/models/human-body.glb` into a single zero-dependency
 * offline HTML file (`dist-offline/jingluo-3d-offline.html`) that runs directly via `file://`
 * in disconnected university classrooms (PRD Section 5 & 6).
 */
function singleFileOfflinePlugin(): Plugin {
  return {
    name: 'jingluo-singlefile-offline',
    enforce: 'post',
    closeBundle() {
      const outDir = path.join(__dirname, 'dist-offline');
      const indexHtmlPath = path.join(outDir, 'index.html');
      if (!fs.existsSync(indexHtmlPath)) {
        throw new Error('Offline build could not find dist-offline/index.html');
      }

      const glbPath = path.join(__dirname, 'public', 'models', 'human-body.glb');
      const glbBase64 = fs.readFileSync(glbPath).toString('base64');

      const assetsDir = path.join(outDir, 'assets');
      const assetFiles = fs.existsSync(assetsDir) ? fs.readdirSync(assetsDir).sort() : [];
      const cssChunks: string[] = [];
      const jsChunks: string[] = [];

      for (const fileName of assetFiles) {
        const fullPath = path.join(assetsDir, fileName);
        if (fileName.endsWith('.css')) {
          cssChunks.push(fs.readFileSync(fullPath, 'utf8'));
        } else if (fileName.endsWith('.js')) {
          jsChunks.push(fs.readFileSync(fullPath, 'utf8'));
        }
      }

      let html = fs
        .readFileSync(indexHtmlPath, 'utf8')
        .replace(/<script\b[^>]*\bsrc="[^"]*"[^>]*><\/script>/gi, '')
        .replace(/<link\b[^>]*\brel="stylesheet"[^>]*>/gi, '')
        .replace(/<link\b[^>]*\brel="modulepreload"[^>]*>/gi, '');

      const inlineCss = cssChunks.join('\n').replace(/<\/style/gi, '<\\/style');
      const inlineJs = jsChunks.join('\n').replace(/<\/script/gi, '<\\/script');

      const headInjection = `<style>${inlineCss}</style>\n    <script>window.__JINGLUO_EMBEDDED_GLB_BASE64__=${JSON.stringify(glbBase64)};</script>`;
      const bodyInjection = `<script>${inlineJs}</script>`;

      html = html.replace('</head>', () => `    ${headInjection}\n  </head>`);
      html = html.replace('</body>', () => `    ${bodyInjection}\n  </body>`);

      fs.writeFileSync(path.join(outDir, 'jingluo-3d-offline.html'), html, 'utf8');
      fs.rmSync(indexHtmlPath, { force: true });
      fs.rmSync(assetsDir, { recursive: true, force: true });
    },
  };
}

export default defineConfig({
  base: './',
  publicDir: false,
  plugins: [react(), tailwindcss(), singleFileOfflinePlugin()],
  build: {
    outDir: 'dist-offline',
    emptyOutDir: true,
    modulePreload: false,
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 5000,
    rollupOptions: {
      output: {
        format: 'iife',
        inlineDynamicImports: true,
      },
    },
  },
});
