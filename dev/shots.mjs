// Quick looks while building:  node dev/shots.mjs [out dir] [only these: phone,desk,dark]
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(join(execSync('npm root -g').toString().trim(), 'playwright')); }
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2] || join(root, 'dev/out');
const only = process.argv[3];
await mkdir(out, { recursive: true });
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  try { const body = await readFile(join(root, path === '/' ? 'index.html' : path)); res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'text/html' }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(0);
const base = `http://localhost:${server.address().port}/`;
const browser = await pw.chromium.launch();

for (const [name, vp, scheme] of [['phone', { width: 390, height: 844 }, 'light'], ['desk', { width: 1280, height: 800 }, 'light'], ['dark', { width: 390, height: 844 }, 'dark']]) {
  if (only && !only.split(',').includes(name)) continue;
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 2, hasTouch: true, colorScheme: scheme, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(() => localStorage.setItem('full-house.v1', JSON.stringify({ progress: { beaten: [true, true], best: [212, 238] } })));
  await page.goto(base);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(out, `${name}-home.png`), fullPage: true });
  await page.click('[data-table="2"]');
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(out, `${name}-intro.png`) });
  await page.click('#b-sit');
  await page.waitForTimeout(500);
  await page.click('#b-roll');
  await page.waitForTimeout(1100);
  await page.click('.die >> nth=1');
  await page.click('.die >> nth=3');
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(out, `${name}-turn.png`) });
  // Score the first open box: tap it twice.
  const row = page.locator('tr.can').first();
  await row.click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(out, `${name}-picked.png`) });
  await row.click();
  await page.waitForTimeout(2200);
  await page.screenshot({ path: join(out, `${name}-theirs.png`) });
  console.log(name, errors.length ? errors : 'ok');
  await ctx.close();
}
await browser.close();
server.close();
