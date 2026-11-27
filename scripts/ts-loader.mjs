import fs from 'node:fs';
import { register } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Self-register as a Node 22 ESM resolve hook when loaded via `--import ./scripts/ts-loader.mjs`
if (process.env.__TS_LOADER_HOOK__ !== '1') {
  process.env.__TS_LOADER_HOOK__ = '1';
  register(import.meta.url, pathToFileURL('./'));
}

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    if (
      (specifier.startsWith('./') || specifier.startsWith('../')) &&
      context.parentURL &&
      !specifier.endsWith('.ts') &&
      !specifier.endsWith('.mjs') &&
      !specifier.endsWith('.js')
    ) {
      const candidateUrl = new URL(`${specifier}.ts`, context.parentURL);
      if (fs.existsSync(fileURLToPath(candidateUrl))) {
        return nextResolve(candidateUrl.href, context);
      }
    }
    throw err;
  }
}
