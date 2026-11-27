import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * DEV-only middleware (`POST /__dev/save-coordinates`) allowing AuditCalibration to persist
 * calibrated GB/T 12346-2021 3D coordinates directly into `data/coordinates-3d.json` after
 * schema + 3D outward-normal validation. Never bundled into production builds.
 */
function devCoordinateSavePlugin(): Plugin {
  return {
    name: 'jingluo-dev-coordinate-save',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__dev/save-coordinates', (req, res, next) => {
        if (req.method !== 'POST') {
          next();
          return;
        }
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          void (async () => {
            try {
              const rawBody = Buffer.concat(chunks).toString('utf8');
              const parsed = JSON.parse(rawBody) as {
                modelId?: string;
                points?: Record<string, { audit?: { status?: string } }>;
              };

              const schemaPath = path.join(__dirname, 'data', 'schema', 'coord3d.schema.json');
              const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
              const ajv = new Ajv({ allErrors: true });
              addFormats(ajv);
              const validate = ajv.compile(schema);
              if (!validate(parsed)) {
                res.statusCode = 400;
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(
                  JSON.stringify({
                    ok: false,
                    error: `Schema 校验失败: ${ajv.errorsText(validate.errors)}`,
                  }),
                );
                return;
              }

              const validatorHref = pathToFileURL(
                path.join(__dirname, 'scripts', 'validate_data.mjs'),
              ).href;
              const validatorMod = (await import(validatorHref)) as {
                validateCoordinateGeometry: (data: unknown) => string[];
              };
              const geoErrors = validatorMod.validateCoordinateGeometry(parsed);
              if (geoErrors.length > 0) {
                res.statusCode = 400;
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                res.end(
                  JSON.stringify({
                    ok: false,
                    error: `3D 几何法线校验失败: ${geoErrors[0]}`,
                  }),
                );
                return;
              }

              const outPath = path.join(__dirname, 'data', 'coordinates-3d.json');
              fs.writeFileSync(outPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');

              let verified = 0;
              let total = 0;
              for (const pt of Object.values(parsed.points ?? {})) {
                total += 1;
                if (pt.audit?.status === 'gb_verified') verified += 1;
              }

              res.statusCode = 200;
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.end(JSON.stringify({ ok: true, verified, total }));
            } catch (err) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              res.end(
                JSON.stringify({
                  ok: false,
                  error: err instanceof Error ? err.message : String(err),
                }),
              );
            }
          })();
        });
      });
    },
  };
}

export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? '/',
  plugins: [react(), tailwindcss(), devCoordinateSavePlugin()],
  server: {
    host: true,
    port: 5173,
  },
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          vendor: ['react', 'react-dom', 'zustand'],
        },
      },
    },
  },
});
