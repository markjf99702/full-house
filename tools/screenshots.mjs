// Renders the README screenshots (docs/*.png) and the link preview (og.png):  node tools/screenshots.mjs
// Math.random is seeded and the games are set up by hand, so the same pictures come out every time.
// Needs Playwright, and upng-js from `npm install`.
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(join(execSync('npm root -g').toString().trim(), 'playwright')); }
const UPNG = require('upng-js');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let body;
  try { body = await readFile(join(root, path === '/' ? 'index.html' : path)); } catch { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'text/html' });
  res.end(body);
}).listen(0);
const base = `http://localhost:${server.address().port}/`;
const browser = await pw.chromium.launch();
await mkdir(join(root, 'docs'), { recursive: true });

async function save(shot, path) {
  const img = UPNG.decode(shot);
  await writeFile(path, Buffer.from(UPNG.encode(UPNG.toRGBA8(img), img.width, img.height, 256)));
}

async function open(viewport, deviceScaleFactor) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor, hasTouch: true, serviceWorkers: 'block', colorScheme: 'light' });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    let a = 9; // mulberry32
    Math.random = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    localStorage.setItem('full-house.v1', JSON.stringify({ progress: { beaten: [true, true], best: [231, 247], played: [2, 3], won: [1, 1] } }));
  });
  await page.goto(base);
  await page.evaluate(() => document.fonts.ready);
  return page;
}

// Part way through a game at Triple Sixes against Bea: your turn, three sixes held after two rolls.
async function midGame(page, turn) {
  await page.evaluate(async turn => {
    const { blankCard } = await import('./js/rules.js');
    const { boardFor } = await import('./js/tour.js');
    const board = boardFor(2, 1);
    const you = { ...blankCard(board), f1: 3, f3: 9, f4: 12, f5: 15, full: 25, small: 30, chance: 23 };
    const them = { ...blankCard(board), f1: 2, f2: 6, f5: 20, three: 24, full: 25, large: 40, chance: 19 };
    window.fullHouse.settings.fast = false;
    window.fullHouse.set({
      table: 2, opp: 2, seed: 1, board, you, them, turn, number: 8, rolls: turn === 'you' ? 2 : 0,
      dice: [6, 6, 2, 6, 5], held: turn === 'you' ? [true, true, false, true, false] : [false, false, false, false, false],
    });
  }, turn);
  await page.waitForTimeout(400);
}

// Phone screenshots for the README.
{
  const page = await open({ width: 390, height: 844 }, 2);
  await save(await page.screenshot(), join(root, 'docs/phone-tour.png'));

  await midGame(page, 'you');
  await page.click('tr[data-box="f6"]');
  await page.waitForTimeout(300);
  await save(await page.screenshot(), join(root, 'docs/phone-play.png'));

  await midGame(page, 'them');
  await page.waitForFunction(() => window.fullHouse.game.held.some(Boolean), null, { timeout: 15000 });
  await page.waitForTimeout(250);
  await save(await page.screenshot(), join(root, 'docs/phone-theirs.png'));

  // The last turn of a game you're ahead in.
  await page.evaluate(async () => {
    const g = structuredClone(window.fullHouse.game);
    Object.assign(g.you, { f2: 6, f6: 54, three: 26, four: 22, large: 40 }); // Five of a kind left open
    Object.assign(g.them, { f3: 9, f4: 12, f6: 36, four: 21, small: 30 });
    g.turn = 'you'; g.rolls = 0; g.number = 13;
    window.fullHouse.settings.fast = true;
    window.fullHouse.set(g);
  });
  await page.waitForFunction(() => window.fullHouse.game.turn === 'you' && !window.fullHouse.busy);
  await page.click('#b-roll');
  await page.waitForFunction(() => !window.fullHouse.busy);
  await page.locator('tr.can').first().click();
  await page.locator('tr.can').first().click();
  await page.click('#tray');
  await page.waitForSelector('#sheet-result:not([hidden])', { timeout: 30000 });
  await page.waitForTimeout(500);
  await save(await page.screenshot(), join(root, 'docs/phone-won.png'));
  await page.context().close();
}

// Link preview, 1200 x 630: the name and one line on the left, the tray and pad on the right.
{
  const page = await open({ width: 470, height: 760 }, 2);
  await midGame(page, 'you');
  await page.click('tr[data-box="f6"]');
  await page.waitForTimeout(300);
  const shot = (await page.screenshot({ clip: { x: 0, y: 44, width: 470, height: 716 } })).toString('base64');
  await page.context().close();

  const font = f => readFile(join(root, 'fonts', f)).then(b => b.toString('base64'));
  const [cond, body] = await Promise.all([font('barlow-condensed-700.woff2'), font('barlow-400.woff2')]);
  const card = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  await card.setContent(`<!doctype html><style>
    @font-face { font-family: Cond; src: url(data:font/woff2;base64,${cond}); }
    @font-face { font-family: Body; src: url(data:font/woff2;base64,${body}); }
    body { margin: 0; width: 1200px; height: 630px; display: grid; grid-template-columns: 1fr 470px; gap: 40px; padding: 0 64px 0 80px; box-sizing: border-box; background: radial-gradient(120% 100% at 30% 20%, #efe6d4, #dccdb2); overflow: hidden; }
    .words { display: flex; flex-direction: column; justify-content: center; }
    h1 { margin: 0; font: 120px/0.9 Cond; text-transform: uppercase; color: #b8432f; }
    p { margin: 28px 0 0; font: 34px/1.3 Body; color: #4b4136; max-width: 520px; }
    img { width: 470px; margin-top: 44px; border-radius: 18px 18px 0 0; box-shadow: 0 18px 50px rgba(60, 35, 10, 0.3); }
  </style>
  <div class="words"><h1>Full House</h1><p>Five dice against eight opponents, on tables that change the rules.</p></div>
  <img src="data:image/png;base64,${shot}">`);
  await card.evaluate(() => document.fonts.ready);
  await save(await card.screenshot(), join(root, 'og.png'));
  await card.close();
}

await browser.close();
server.close();
console.log('screenshots written');
