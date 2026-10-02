// Bundles the game into one self-contained HTML file, dist/full-house.html, for sharing as a single page.
// Also writes dist/artifact.html, the same page without the document wrapper,
// for hosts that supply their own <html>/<head>/<body>. The repo itself runs without this step.
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const root = new URL('..', import.meta.url);
const read = p => readFile(new URL(p, root), 'utf8');

const result = await build({ entryPoints: [new URL('js/app.js', root).pathname], bundle: true, format: 'iife', minify: true, target: 'es2020', write: false });
// data-single tells the page it's the one-file copy, which has no service worker to register.
const js = `document.documentElement.dataset.single = '';\n${result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')}`;

const dataUri = async (path, type) => `data:${type};base64,${(await readFile(new URL(path, root))).toString('base64')}`;
let css = await read('css/app.css');
// Pages shown inside a host with its own light/dark switch get data-theme on <html>:
// follow the system unless it says light, and go dark when it says dark.
const dark = css.match(/@media \(prefers-color-scheme: dark\) \{\n  :root \{([^}]*)\}\n\}/);
if (!dark) throw new Error('css/app.css: dark palette block not found');
css = css.replace(dark[0], `@media (prefers-color-scheme: dark) {\n  :root:not([data-theme="light"]) {${dark[1]}}\n}\n:root[data-theme="dark"] {${dark[1]}}`);
for (const [, file] of css.matchAll(/url\(\.\.\/(fonts\/[^)]+\.woff2)\)/g)) css = css.replace(`url(../${file})`, `url(${await dataUri(file, 'font/woff2')})`);
const icon = await dataUri('icon.svg', 'image/svg+xml');
const html = (await read('index.html'))
  .replace(/ *<script src="carry\.js"><\/script>\n/, '') // only needed at the game's own address
  .replace(/ *<link rel="(manifest|apple-touch-icon|preload)"[^>]*>\n/g, '')
  .replaceAll('"icon.svg"', () => `"${icon}"`)
  .replace('<link rel="stylesheet" href="css/app.css">', () => `<style>\n${css}</style>`)
  .replace(/ *<script type="module" src="js\/app.js"><\/script>\n/, '')
  .replace('</body>', () => `<script>\n${js}</script>\n</body>`);

const fragment = html
  .replace(/<!doctype html>\s*/i, '')
  .replace(/<\/?html[^>]*>\s*/gi, '')
  .replace(/<\/?head>\s*/gi, '')
  .replace(/<\/?body[^>]*>\s*/gi, '')
  .replace(/<meta charset[^>]*>\s*/i, '')
  .replace(/<meta name="viewport"[^>]*>\s*/i, '');

// That host pads the page clear of a phone's notch and home bar itself, so the game fills the padded frame
// instead of the whole screen, and nothing adds the same padding again.
const swaps = [
  ['html, body { margin: 0; min-height: 100%; }', 'html, body { margin: 0; height: 100%; }'],
  ['height: 100vh;\n  height: 100dvh;', 'height: 100%;'],
  ['padding: calc(6px + env(safe-area-inset-top)) ', 'padding: 6px '],
  ['padding: calc(28px + env(safe-area-inset-top)) 16px calc(24px + env(safe-area-inset-bottom));', 'padding: 28px 16px 24px;'],
  ['padding: 12px 12px calc(14px + env(safe-area-inset-bottom));', 'padding: 12px 12px 14px;'],
];
let embedded = fragment;
for (const [from, to] of swaps) {
  if (!embedded.includes(from)) throw new Error(`build: expected to find ${JSON.stringify(from)} in the page`);
  embedded = embedded.replace(from, to);
}

await mkdir(new URL('dist/', root), { recursive: true });
await writeFile(new URL('dist/full-house.html', root), html);
await writeFile(new URL('dist/artifact.html', root), embedded);
console.log(`dist/full-house.html  ${(html.length / 1024).toFixed(1)} KB`);
