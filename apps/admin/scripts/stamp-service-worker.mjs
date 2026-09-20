/**
 * Generate `public/sw.js` from the template, stamping in this build's id.
 *
 * The worker registers from the origin root, so it controls the whole admin
 * application and serves build assets cache-first. That is only safe while the cache
 * name is unique per deployment: with a fixed name, a browser that visited an earlier
 * build keeps serving that build's JavaScript indefinitely and never sees new screens,
 * however many times the server is rebuilt.
 *
 * Next writes a fresh BUILD_ID for every build, which is exactly the value needed. The
 * template under `src/sw/` is the source of truth and is never modified; the generated
 * file in `public/` is a build artefact.
 *
 * Run after `next build`, and standalone in development where there is no build id.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const template = resolve(root, 'src/sw/sw.template.js');
const output = resolve(root, 'public/sw.js');
const buildIdFile = resolve(root, '.next/BUILD_ID');
const PLACEHOLDER = '__RIZA_BUILD_ID__';

if (!existsSync(template)) throw new Error('src/sw/sw.template.js is missing');
const source = readFileSync(template, 'utf8');
if (!source.includes(PLACEHOLDER))
  throw new Error(`the service worker template no longer contains ${PLACEHOLDER}`);

// In development there is no build id yet; a stable development name is correct there,
// because the dev server does not register the worker at all.
const buildId = existsSync(buildIdFile) ? readFileSync(buildIdFile, 'utf8').trim() : 'development';
if (!buildId) throw new Error('.next/BUILD_ID is empty');

writeFileSync(output, source.replaceAll(PLACEHOLDER, buildId));
console.log(`service worker cache version: riza-shell-${buildId}`);
