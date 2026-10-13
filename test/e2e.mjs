// Plays the game in Chromium through the real page:  node test/e2e.mjs  (needs Playwright)
// Give it part of a step's name to run only the steps that match:  node test/e2e.mjs tour
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require(join(execSync('npm root -g').toString().trim(), 'playwright')); }
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
const only = process.argv.slice(2).join(' ');

// Each step starts on a fresh page with nothing saved: a phone, or a desktop with a mouse.
async function step(name, fn, { desktop = false, serviceWorkers = 'block' } = {}) {
  if (only && !name.includes(only)) return;
  const size = desktop ? { viewport: { width: 1280, height: 800 } } : { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true };
  const ctx = await browser.newContext({ ...size, serviceWorkers });
  const page = await ctx.newPage();
  const problems = [];
  page.on('pageerror', e => problems.push(e.message));
  page.on('console', m => { if (m.type() === 'error') problems.push(m.text()); });
  page.on('requestfailed', r => problems.push('failed: ' + r.url()));
  page.on('request', r => { if (!r.url().startsWith(base)) problems.push('left the site: ' + r.url()); });
  const game = () => page.evaluate(() => window.fullHouse.game);
  const myTurn = () => page.waitForFunction(() => window.fullHouse.game?.turn === 'you' && !window.fullHouse.busy, null, { timeout: 30000 });
  const settled = () => page.waitForFunction(() => !window.fullHouse.busy, null, { timeout: 30000 });
  try {
    await page.goto(base);
    await page.evaluate(() => document.fonts.ready);
    await fn({ page, ctx, game, myTurn, settled });
    assert.deepEqual(problems.filter(p => !p.startsWith('failed:')), [], `problems while playing: ${name}`);
  } finally {
    await ctx.close();
  }
  console.log(`ok  ${name}`);
}

// The last turn of a game you're well ahead in, with only Chance left to fill: roll and score it.
async function lastTurn({ page, myTurn, settled }) {
  await page.evaluate(() => {
    const g = structuredClone(window.fullHouse.game);
    for (const b of g.board.boxes) { g.you[b.id] = b.id === 'chance' ? null : 20; g.them[b.id] = b.id === 'chance' ? null : 5; }
    Object.assign(g, { number: 13, rolls: 0, turn: 'you' });
    window.fullHouse.settings.fast = true;
    window.fullHouse.set(g);
  });
  await myTurn();
  await page.click('#b-roll');
  await settled();
  await page.locator('tr.can').first().click();
  await page.locator('tr.can').first().click();
}
// ...and once the opponent has played their last turn, the result.
async function win(t) {
  await lastTurn(t);
  await t.page.waitForSelector('#sheet-result:not([hidden])', { timeout: 30000 });
}

try {
  await step('a game through the tour', async ({ page, ctx, game, myTurn, settled }) => {
    // The tour: the first table open, the rest locked.
    assert.equal(await page.locator('#tables li').count(), 8);
    assert.match(await page.textContent('#tables li:nth-child(1)'), /Next up/);
    assert.equal(await page.locator('#tables li.locked').count(), 7);

    // Sit down at table 1.
    await page.click('[data-table="0"]');
    await page.waitForSelector('#sheet-intro:not([hidden])');
    assert.match(await page.textContent('#intro-title'), /Classic/);
    await page.click('#b-sit');
    assert.equal(await page.evaluate(() => document.body.dataset.screen), 'game');
    await page.evaluate(() => { window.fullHouse.settings.fast = true; });

    // Roll, hold two dice, roll again: the held dice stay put.
    await page.click('#b-roll');
    await settled();
    let g = await game();
    assert.equal(g.rolls, 1);
    await page.click('.die >> nth=0');
    await page.click('.die >> nth=1');
    assert.equal(await page.getAttribute('.die >> nth=0', 'aria-pressed'), 'true');
    const kept = (await game()).dice.slice(0, 2);
    await page.click('#b-roll');
    await settled();
    g = await game();
    assert.equal(g.rolls, 2);
    assert.deepEqual(g.dice.slice(0, 2), kept, 'held dice were not rolled');

    // Pick a box, then tap it again to score it. Then the opponent plays its turn.
    const row = page.locator('tr.can').first();
    const id = await row.getAttribute('data-box');
    await row.click();
    assert.match(await page.textContent('#status'), /again to score/);
    await row.click();
    g = await game();
    assert.notEqual(g.you[id], null, 'the score went in');
    assert.equal(g.turn, 'them');
    await page.click('#tray'); // hurry them along
    await myTurn();
    g = await game();
    assert.equal(Object.values(g.them).filter(v => v !== null).length - 1, 1, 'the opponent filled one box'); // minus `extras`
    assert.equal(g.number, 2);

    // A game in progress survives a reload.
    await page.reload();
    await myTurn();
    assert.deepEqual((await game()).you, g.you);
    assert.equal(await page.evaluate(() => document.body.dataset.screen), 'game');

    // The last turn of a game you're well ahead in: win, and the next table opens.
    await page.evaluate(() => {
      const g = structuredClone(window.fullHouse.game);
      const ids = g.board.boxes.map(b => b.id);
      for (const id of ids.slice(0, 12)) { g.you[id] = 20; g.them[id] = 5; }
      g.you.chance = null; g.them.chance = null;
      g.number = 13; g.rolls = 0; g.turn = 'you';
      window.fullHouse.settings.fast = true;
      window.fullHouse.set(g);
    });
    await myTurn();
    await page.click('#b-roll');
    await settled();
    await page.locator('tr.can').first().click();
    await page.locator('tr.can').first().click();
    await page.click('#tray');
    await page.waitForSelector('#sheet-result:not([hidden])', { timeout: 30000 });
    assert.match(await page.textContent('#result-title'), /You beat Pip/);
    assert.match(await page.textContent('#b-next'), /On to table 2/);
    const progress = await page.evaluate(() => window.fullHouse.progress);
    assert.equal(progress.beaten[0], true);
    assert.equal(progress.played[0], 1);
    await page.click('#b-next');
    await page.waitForSelector('#sheet-intro:not([hidden])');
    assert.match(await page.textContent('#intro-title'), /Evens/);

    // Table 2 has an Evens box where the Ones were.
    await page.click('#b-sit');
    assert.equal(await page.locator('tr[data-box="evens"]').count(), 1);
    assert.equal(await page.locator('tr[data-box="f1"]').count(), 0);

    // Giving up counts as a game played, and goes back to the tour, where table 2 is next.
    await page.click('#b-menu');
    await page.click('#b-concede');
    assert.equal(await page.evaluate(() => document.body.dataset.screen), 'home');
    assert.equal((await page.evaluate(() => window.fullHouse.progress)).played[1], 1);
    assert.match(await page.textContent('#tables li:nth-child(2)'), /Next up/);
    assert.match(await page.textContent('#tables li:nth-child(1)'), /Beaten/);
    assert.equal(await page.locator('#people button').count(), 2, 'Pip and Maud for a quick game');

    // A quick game: classic rules against someone you've met.
    await page.click('[data-quick="1"]');
    assert.match(await page.textContent('#g-table'), /Quick game/);
    assert.match(await page.textContent('#g-twist'), /Maud/);

    // Fits a phone: nothing scrolls sideways.
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'the page scrolls sideways on a phone');

    // Works offline once it has been opened.
    await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 10000 }).catch(() => {});
    await ctx.setOffline(true);
    await page.reload();
    await page.waitForFunction(() => window.fullHouse?.game);
    assert.equal(await page.locator('.die').count(), 5, 'the game did not load offline');
    await ctx.setOffline(false);
  }, { serviceWorkers: 'allow' });

  await step('the opponent plays one turn, even after back and carry on while the turn passes', async ({ page, game, myTurn, settled }) => {
    await page.click('[data-table="0"]');
    await page.click('#b-sit');
    await page.evaluate(() => { window.fullHouse.settings.fast = true; });
    await page.click('#b-roll');
    await settled();
    // Score a box, then back to the tour and carry on, all before the opponent has started.
    await page.evaluate(() => {
      const row = () => document.querySelector('#pad tr.can');
      const id = row().dataset.box;
      row().click();
      document.querySelector(`#pad tr[data-box="${id}"]`).click();
      document.getElementById('b-home').click();
      document.getElementById('b-continue').click();
    });
    await myTurn();
    await page.waitForTimeout(3000); // a second copy of the turn would land a moment after the first
    let g = await game();
    assert.equal(g.turn, 'you');
    assert.equal(g.number, 2, 'one turn each');
    assert.equal(Object.values(g.them).filter(v => v !== null).length - 1, 1, 'the opponent filled one box');

    // The same just after opening the game again during the opponent's turn.
    await page.click('#b-roll');
    await settled();
    await page.locator('tr.can').first().click();
    await page.locator('tr.can').first().click();
    await page.reload({ waitUntil: 'commit' });
    await page.waitForFunction(() => {
      if (!window.fullHouse) return false;
      document.getElementById('b-home').click();
      document.getElementById('b-continue').click();
      return true;
    }, null, { polling: 10 });
    await myTurn();
    await page.waitForTimeout(3000);
    g = await game();
    assert.equal(g.number, 3, 'one turn each');
    assert.equal(Object.values(g.them).filter(v => v !== null).length - 1, 2, 'the opponent filled one box a turn');
  });

  await step('tapping the dice hurries the opponent along', async ({ page, myTurn, settled }) => {
    await page.click('[data-table="0"]');
    await page.click('#b-sit');
    await page.click('#b-roll');
    await settled();
    await page.locator('tr.can').first().click();
    await page.locator('tr.can').first().click();
    await page.waitForFunction(() => /rolls\.$/.test(document.getElementById('status').textContent));
    // At the usual pace their turn takes four and a half seconds; tapping their dice (not the felt) rushes it.
    const t0 = Date.now();
    const die = await page.locator('.die >> nth=2').boundingBox();
    for (let i = 0; i < 3; i++) await page.touchscreen.tap(die.x + die.width / 2, die.y + die.height / 2);
    await myTurn();
    assert.ok(Date.now() - t0 < 3000, `their turn took ${Date.now() - t0} ms after tapping the dice`);
  });

  await step('a finished game is not offered to carry on', async t => {
    const { page } = t;
    const screen = () => page.evaluate(() => document.body.dataset.screen);
    await page.click('[data-table="0"]');
    await page.click('#b-sit');
    await win(t);
    // On to table 2, then Not yet: you're left on the finished game. Back to the tour.
    await page.click('#b-next');
    await page.click('#sheet-intro [data-close].plain');
    assert.equal(await screen(), 'game');
    await page.click('#b-home');
    assert.ok(await page.isHidden('#b-continue'), 'Carry on offered for a finished game');

    // Escape on the result sheet, then Give up from the menu: back to the tour.
    await page.click('[data-table="0"]');
    await page.click('#b-sit');
    await win(t);
    await page.keyboard.press('Escape');
    await page.click('#b-menu');
    await page.click('#b-concede');
    assert.equal(await screen(), 'home');
    assert.ok(await page.isHidden('#sheet-menu'));
    assert.ok(await page.isHidden('#b-continue'), 'Carry on offered for a finished game');
    assert.equal((await page.evaluate(() => window.fullHouse.progress)).played[0], 2, 'two games played, no extra loss');
  });

  await step('giving up while the opponent writes a score leaves no trace in the next game', async ({ page, settled }) => {
    await page.click('[data-table="0"]');
    await page.click('#b-sit');
    await page.click('#b-roll');
    await settled();
    await page.locator('tr.can').first().click();
    await page.locator('tr.can').first().click();
    // While "Pip scores N in X" shows, give up and start a quick game.
    await page.waitForFunction(() => {
      if (!/scores \d+ in/.test(document.getElementById('status').textContent)) return false;
      document.getElementById('b-menu').click();
      document.getElementById('b-concede').click();
      document.querySelector('[data-quick="0"]').click();
      return true;
    }, null, { polling: 20, timeout: 30000 });
    assert.equal(await page.textContent('#g-table'), 'Quick game');
    assert.equal(await page.locator('#pad td.them.offer').count(), 0, 'a score from the last game is pencilled in');
  });

  await step('reloading during the opponent’s turn plays the same turn again', async ({ page, game, myTurn, settled }) => {
    await page.click('[data-table="0"]');
    await page.click('#b-sit');
    await page.click('#b-roll');
    await settled();
    await page.locator('tr.can').first().click();
    await page.locator('tr.can').first().click();
    // What the opponent is about to write in, and the dice it has: reload before it's written, and it comes out the same.
    const about = () => page.waitForFunction(() => {
      const said = document.getElementById('status').textContent;
      return /scores \d+ in/.test(said) && `${said} ${window.fullHouse.game.dice.join('')}`;
    }, null, { polling: 20, timeout: 30000 }).then(h => h.jsonValue());
    const before = await about();
    await page.reload();
    assert.equal(await about(), before, 'a reload gave the opponent another go at their turn');
    await myTurn();
    const them = Object.entries((await game()).them).filter(([id, v]) => id !== 'extras' && v !== null);
    assert.equal(them.length, 1, 'the opponent filled one box');
    assert.equal(them[0][1], +/scores (\d+) in/.exec(before)[1], 'the opponent wrote a different score from the one it said');
  });

  await step('with all five dice held there is nothing to roll', async ({ page, game, settled }) => {
    await page.click('[data-table="0"]');
    await page.click('#b-sit');
    await page.click('#b-roll');
    await settled();
    for (let i = 0; i < 5; i++) await page.click(`.die >> nth=${i}`);
    assert.ok(await page.isDisabled('#b-roll'), 'Roll is on with every die held');
    await page.evaluate(() => document.activeElement.blur());
    await page.keyboard.press(' ');
    assert.equal((await game()).rolls, 1, 'a roll was used up with every die held');
    // Let one go and you can roll again.
    await page.click('.die >> nth=4');
    assert.ok(await page.isEnabled('#b-roll'));
  });

  await step('with a mouse, a picked box shows its amber fill', async ({ page, settled }) => {
    await page.click('[data-table="0"]');
    await page.click('#b-sit');
    await page.click('#b-roll');
    await settled();
    const box = await page.locator('tr.can').first().boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.move(box.x + box.width / 2 + 2, box.y + box.height / 2); // the pointer rests on the picked row
    const fill = () => page.evaluate(() => getComputedStyle(document.querySelector('tr.picked th')).backgroundColor);
    assert.equal(await fill(), 'rgba(227, 168, 43, 0.38)', 'the picked row is grey under the pointer');

    // A box that scores three times over has a tint of its own, which picking it covers too.
    await page.evaluate(() => window.fullHouse.start(2));
    await page.click('#b-roll');
    await settled();
    await page.click('tr[data-box="f6"]');
    await page.mouse.move(0, 0);
    assert.equal(await fill(), 'rgba(227, 168, 43, 0.38)', 'a picked box at three times keeps its own tint');
  }, { desktop: true });

  await step('keyboard: R rolls wherever the focus is, and the browser keeps its shortcuts', async ({ page, game, settled }) => {
    await page.click('[data-table="0"]');
    await page.click('#b-sit');
    await page.evaluate(() => addEventListener('keydown', e => { window.kept = e.defaultPrevented; }));
    await page.keyboard.press('Control+r');
    assert.equal((await game()).rolls, 0, 'Ctrl+R rolled the dice');
    assert.equal(await page.evaluate(() => window.kept), false, 'Ctrl+R was kept from the browser');
    await page.keyboard.press('r');
    await settled();
    assert.equal((await game()).rolls, 1);
    await page.keyboard.press('Control+1');
    assert.equal((await game()).held[0], false, 'Ctrl+1 held a die');
    await page.click('.die >> nth=0'); // holds it, and the focus is on it now
    await page.keyboard.press('Shift+R');
    await settled();
    assert.equal((await game()).rolls, 2, 'R did nothing with a die focused');
  }, { desktop: true });

  await step('keyboard: Enter on a box picks it, and Enter again scores it', async ({ page, game, settled }) => {
    await page.click('[data-table="0"]');
    await page.click('#b-sit');
    await page.keyboard.press('r');
    await settled();
    await page.focus('tr.can >> nth=0'); // where Tab gets to after the dice and Roll
    const id = await page.evaluate(() => document.activeElement.dataset.box);
    await page.keyboard.press('Enter');
    assert.match(await page.textContent('#status'), /again to score/);
    await page.keyboard.press('Enter');
    const g = await game();
    assert.notEqual(g.you[id], null, 'the second Enter did not score the box');
    assert.equal(g.turn, 'them');
  }, { desktop: true });

  await step('with a mouse, Space still rolls after picking a box', async ({ page, game, settled }) => {
    await page.click('[data-table="0"]');
    await page.click('#b-sit');
    await page.click('#b-roll');
    await settled();
    const row = page.locator('tr.can').first();
    const id = await row.getAttribute('data-box');
    await row.click(); // picked, to see what it would score
    assert.match(await page.textContent('#status'), /again to score/);
    await page.keyboard.press(' ');
    await settled();
    const g = await game();
    assert.equal(g.you[id], null, 'Space scored the box picked with the mouse');
    assert.equal(g.rolls, 2);
  }, { desktop: true });

  await step('keyboard: Tab stays inside an open sheet, and the focus comes back after', async ({ page }) => {
    await page.focus('[data-table="0"]');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#sheet-intro:not([hidden])');
    const reached = [];
    for (let i = 0; i < 6; i++) {
      await page.keyboard.press('Tab');
      reached.push(await page.evaluate(() => {
        const a = document.activeElement;
        return a === document.body || a.closest('#sheet-intro') ? '' : a.textContent.trim();
      }));
    }
    assert.deepEqual(reached.filter(Boolean), [], 'Tab reached the page behind the sheet');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.table), '0', 'the focus did not come back to table 1');
  }, { desktop: true });

  await step('the result of a finished game does not pop up over the next one', async t => {
    const { page } = t;
    await page.click('[data-table="0"]');
    await page.click('#b-sit');
    await lastTurn(t);
    // As soon as the game is over, before its result shows: back to the tour and a quick game.
    await page.waitForFunction(() => {
      if (!window.fullHouse.game?.over) return false;
      document.getElementById('b-home').click();
      document.querySelector('[data-quick="0"]').click();
      return true;
    }, null, { polling: 20, timeout: 30000 });
    await page.waitForTimeout(1500);
    assert.ok(await page.isHidden('#sheet-result'), 'the last game’s result popped up over the new one');
    assert.equal(await page.textContent('#g-table'), 'Quick game');
  });

  await step('a damaged save opens on the tour, keeping what it can', async ({ page }) => {
    await page.click('[data-table="0"]');
    await page.click('#b-sit');
    const good = await page.evaluate(() => structuredClone(window.fullHouse.game));
    const load = async save => {
      await page.evaluate(s => localStorage.setItem('full-house.v1', s), JSON.stringify(save));
      await page.reload();
      return page.evaluate(() => document.body.dataset.screen);
    };
    // Progress with a part that isn't a list: the tour still shows.
    await load({ progress: { beaten: null, best: [250] } });
    assert.equal(await page.locator('#tables li').count(), 8);
    assert.equal(await page.locator('#people button').count(), 1);
    // A game with parts missing or out of range is dropped, and the progress kept.
    const progress = { beaten: [true], best: [250], played: [1], won: [1] };
    const broken = [{ table: 0, opp: 0, turn: 'you', number: 1, rolls: 0 }, {}, { ...good, opp: 99 }, { ...good, turn: 'them', you: null, them: null }, { ...good, dice: [0, 1, 2, 3, 4] }];
    for (const g of broken) {
      assert.equal(await load({ progress, game: g }), 'home');
      assert.ok(await page.isHidden('#b-continue'), `a damaged game is offered to carry on: ${JSON.stringify(g).slice(0, 50)}`);
      assert.match(await page.textContent('#tables li:nth-child(2)'), /Next up/);
    }
    // A whole game still picks up where it was.
    assert.equal(await load({ progress, game: good }), 'game');
  });

  await step('a new game’s dice show the numbers they’re read out as', async ({ page, settled }) => {
    await page.click('[data-table="0"]');
    await page.click('#b-sit');
    await page.click('#b-roll');
    await settled();
    await page.click('#b-menu');
    await page.click('#b-concede');
    await page.click('[data-quick="0"]');
    // Which face each cube is turned to show, from its rotation.
    const dice = await page.evaluate(() => [...document.querySelectorAll('.die')].map(b => {
      const [x, y] = b.querySelector('.cube').style.transform.match(/-?\d+/g).map(n => ((+n % 360) + 360) % 360);
      return [{ '0,0': 1, '0,270': 2, '270,0': 3, '90,0': 4, '0,90': 5, '0,180': 6 }[`${x},${y}`], +b.getAttribute('aria-label')];
    }));
    for (const [shown, read] of dice) assert.equal(shown, read, `a die shows ${shown} and is read out as ${read}`);
  });

  await step('the tour’s footer has the house line, then How to play', async ({ page }) => {
    assert.deepEqual(await page.locator('.jd-foot a, .jd-foot button').allTextContents(), ['Part of junkdrawer.works', 'Privacy', 'How to play']);
    await page.click('#b-rules');
    assert.ok(await page.isVisible('#sheet-rules .panel'));
  });

  await step('a save stuck with both cards full on the opponent’s turn ends the game', async ({ page, myTurn }) => {
    await page.click('[data-table="0"]');
    await page.click('#b-sit');
    const stuck = async (theirs, yours) => {
      await page.evaluate(([theirs, yours]) => {
        const g = structuredClone(window.fullHouse.game);
        g.board.boxes.forEach((b, i) => { g.them[b.id] = i < theirs ? 5 : null; g.you[b.id] = i < yours ? 20 : null; });
        Object.assign(g, { number: 14, rolls: 3, turn: 'them' });
        localStorage.setItem('full-house.v1', JSON.stringify({ settings: { fast: true }, progress: window.fullHouse.progress, game: g }));
      }, [theirs, yours]);
      await page.reload();
    };
    // The opponent's card is full but yours isn't: it's your turn.
    await stuck(13, 11);
    await myTurn();
    // Both full: the game ends.
    await stuck(13, 13);
    await page.waitForSelector('#sheet-result:not([hidden])', { timeout: 15000 });
    assert.match(await page.textContent('#result-title'), /You beat Pip/);
  });
} finally {
  await browser.close();
  server.close();
}
console.log('all good');
