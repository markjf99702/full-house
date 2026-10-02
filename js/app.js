// Full House: the tour, a game in progress, and the opponent's turns played out on the table.

import { blankCard, options, mark, totals, filled, boxLabel } from './rules.js';
import { TABLES, boardFor, CLASSIC } from './tour.js';
import { Opponent } from './ai.js';
import { Tray } from './dice.js';
import { Pad } from './pad.js';

const KEY = 'full-house.v1';
const $ = id => document.getElementById(id);
const saved = read();
const settings = { fast: false, hints: true, ...saved.settings };
const progress = { beaten: [], best: [], played: [], won: [], quick: { played: 0, won: 0 }, ...saved.progress };

let game = saved.game && !saved.game.over ? saved.game : null;
let busy = false;      // dice in the air, or the opponent playing
let hurry = false;     // the player tapped to hurry the opponent along
let picked = null;     // the box you've tapped once and not yet scored
let fresh = {};        // boxes just written in, pencilled in as you watch
let theirPick = null;  // the box the opponent is about to write in
let token = 0;         // changes whenever a game starts or ends, so a turn being played out knows to stop

const tray = new Tray($('tray'), { onToggle: toggle, onTap: () => { if (busy && game?.turn === 'them') hurry = true; } });
const pad = new Pad($('pad'), { onPick: pick });
const who = g => TABLES[g.opp].who;
const die = () => 1 + Math.floor(Math.random() * 6);

// ---- your turn ----

function roll() {
  const g = game;
  if (!g || busy || g.turn !== 'you' || g.rolls >= g.board.rolls) return;
  picked = null;
  const rolled = [];
  g.dice = g.dice.map((d, i) => (g.held[i] && g.rolls > 0 ? d : (rolled.push(i), die())));
  if (g.rolls === 0) g.held = [false, false, false, false, false];
  g.rolls++;
  busy = true;
  showDice(rolled);
  render();
  save();
  setTimeout(() => { busy = false; showDice(); render(); }, settings.fast ? 450 : 750);
}

function toggle(i) {
  const g = game;
  if (!g || busy || g.turn !== 'you' || g.rolls === 0 || g.rolls >= g.board.rolls) return;
  g.held[i] = !g.held[i];
  picked = null;
  showDice();
  render();
  save();
}

// Tap a box once to pick it, again to score it.
function pick(id) {
  const g = game;
  if (!g || busy || g.turn !== 'you' || g.rolls === 0) return;
  if (picked !== id) { picked = id; render(); return; }
  const option = options(g.board, g.you, g.dice).find(o => o.box.id === id);
  if (!option) return;
  g.you = mark(g.you, option);
  fresh = { you: id };
  picked = null;
  if (option.extra) toast(`Another five of a kind: ${g.board.extra} extra points.`);
  else if (option.box.kind === 'five' && option.score) toast('Five of a kind!');
  g.turn = 'them';
  g.held = [false, false, false, false, false];
  save();
  render();
  showDice();
  setTimeout(theirTurn, settings.fast ? 300 : 650);
}

// ---- the opponent's turn ----

const PACE = { normal: { roll: 800, think: 650, choose: 850 }, fast: { roll: 420, think: 280, choose: 420 } };

function wait(ms) {
  return new Promise(resolve => {
    const t0 = performance.now();
    const tick = () => (performance.now() - t0 >= (hurry ? Math.min(ms, 140) : ms) ? resolve() : setTimeout(tick, 30));
    tick();
  });
}

async function theirTurn() {
  const g = game, t = token;
  if (!g || g.turn !== 'them' || g.over) return;
  const still = () => t === token && game === g;
  const pace = PACE[settings.fast ? 'fast' : 'normal'], name = who(g).name, b = g.board;
  const opp = new Opponent(TABLES[g.opp].play);
  busy = true;
  hurry = false;

  g.held = [false, false, false, false, false];
  g.dice = g.dice.map(die);
  g.rolls = 1;
  status(`${name} rolls.`);
  showDice([0, 1, 2, 3, 4]);
  render();
  await wait(pace.roll);
  if (!still()) return;

  for (let left = b.rolls - 1; left > 0; left--) {
    const keep = opp.keep(b, g.them, g.dice, left);
    if (!keep) break;
    g.held = keep;
    const n = keep.filter(Boolean).length;
    status(n ? `${name} holds ${n === 1 ? 'one' : ['', '', 'two', 'three', 'four'][n]} and rolls again.` : `${name} rolls them all again.`);
    showDice();
    await wait(pace.think);
    if (!still()) return;
    const rolled = [];
    g.dice = g.dice.map((d, i) => (keep[i] ? d : (rolled.push(i), die())));
    g.rolls++;
    showDice(rolled);
    await wait(pace.roll);
    if (!still()) return;
  }

  const option = opp.box(b, g.them, g.dice);
  theirPick = { id: option.box.id, score: option.score };
  status(`${name} scores ${option.score} in ${boxLabel(option.box)}.`);
  render();
  await wait(pace.choose);
  if (!still()) return;

  g.them = mark(g.them, option);
  theirPick = null;
  fresh = { them: option.box.id };
  if (option.extra) toast(`${name} rolls another five of a kind: ${b.extra} extra points.`);
  else if (option.box.kind === 'five' && option.score) toast(`${name} rolls five of a kind.`);

  if (filled(b, g.you) && filled(b, g.them)) { finish(); return; }
  g.turn = 'you';
  g.number++;
  g.rolls = 0;
  g.held = [false, false, false, false, false];
  busy = false;
  hurry = false;
  save();
  render();
  showDice();
}

// ---- starting and finishing ----

function start(table, opp = table) {
  const seed = (Math.random() * 2 ** 31) | 0;
  const board = table === null ? CLASSIC : boardFor(table, seed);
  if (game && !game.over) concede(true);
  token++;
  game = {
    table, opp, seed, board,
    you: blankCard(board), them: blankCard(board),
    turn: 'you', number: 1, rolls: 0,
    dice: [die(), die(), die(), die(), die()], held: [false, false, false, false, false],
  };
  busy = false;
  picked = null;
  closeSheets();
  open('game');
  save();
  showDice();
  render();
}

function finish() {
  const g = game, b = g.board;
  token++;
  busy = false;
  g.over = true;
  const you = totals(b, g.you).total, them = totals(b, g.them).total, name = who(g).name;
  const won = you > them, tie = you === them;
  if (g.table !== null) {
    const i = g.table;
    progress.played[i] = (progress.played[i] || 0) + 1;
    if (won) { progress.won[i] = (progress.won[i] || 0) + 1; progress.beaten[i] = true; }
    progress.best[i] = Math.max(progress.best[i] || 0, you);
  } else {
    progress.quick.played++;
    if (won) progress.quick.won++;
  }
  save();
  render();
  showDice();
  status(won ? 'You win.' : tie ? 'A tie.' : `${name} wins.`);

  $('result-title').textContent = won ? `You beat ${name}` : tie ? 'A tie' : `${name} wins`;
  const last = g.table === TABLES.length - 1;
  $('result-line').textContent = won
    ? g.table === null ? 'A good game.' : last ? 'That’s the whole tour. Nobody at these tables has anything left to teach you.' : `Table ${g.table + 2} is open: ${TABLES[g.table + 1].board.name}, against ${TABLES[g.table + 1].who.name}.`
    : tie ? 'Play it again to settle it.' : 'The dice owe you one. Try again?';
  $('result-scores').innerHTML = `<div><span>You</span><b>${you}</b></div><div><span>${escape(name)}</span><b>${them}</b></div>`;
  const next = $('b-next');
  if (won && g.table !== null && !last) { next.textContent = `On to table ${g.table + 2}`; next.onclick = () => intro(g.table + 1); }
  else { next.textContent = 'Play again'; next.onclick = () => start(g.table, g.opp); }
  $('b-again').hidden = !(won && g.table !== null && !last);
  setTimeout(() => openSheet('sheet-result'), 900);
}

// Leaving a game part way counts as a loss at that table.
function concede(quietly) {
  const g = game;
  if (!g || g.over) return;
  token++;
  if (g.table !== null) progress.played[g.table] = (progress.played[g.table] || 0) + 1;
  else progress.quick.played++;
  g.over = true;
  game = null;
  busy = false;
  save();
  if (!quietly) { closeSheets(); open('home'); }
}

// ---- drawing ----

function showDice(rolled = []) {
  const g = game;
  if (!g) return;
  const mine = g.turn === 'you';
  tray.show(g.dice, g.held, {
    rolled,
    theirs: !mine,
    idle: mine && g.rolls === 0,
    canHold: mine && !busy && g.rolls > 0 && g.rolls < g.board.rolls,
  });
}

function render() {
  const g = game;
  if (!g) return;
  const b = g.board, opp = who(g), mine = g.turn === 'you' && !g.over;
  const turns = b.boxes.length;
  $('g-table').textContent = g.table === null ? 'Quick game' : `Table ${g.table + 1}: ${b.name}`;
  $('g-twist').textContent = `against ${opp.name} · turn ${Math.min(g.number, turns)} of ${turns}`;
  document.documentElement.style.setProperty('--them-colour', opp.colour);

  const offers = mine && g.rolls > 0 && !busy ? Object.fromEntries(options(b, g.you, g.dice).map(o => [o.box.id, o.score])) : null;
  pad.render({ board: b, you: g.you, them: g.them, name: opp.name, offers, picked, fresh, hints: settings.hints, theirPick });
  fresh = {};

  const left = b.rolls - g.rolls;
  $('rolls').innerHTML = Array.from({ length: b.rolls }, (_, i) => `<i class="${i < g.rolls && (mine || g.turn === 'them') ? 'used' : ''}"></i>`).join('');
  const button = $('b-roll');
  button.disabled = !mine || busy || left <= 0;
  button.textContent = !mine ? (g.over ? 'Game over' : `${opp.name}’s turn`) : g.rolls === 0 ? 'Roll' : left > 0 ? `Roll again (${left} left)` : 'No rolls left';

  if (mine && !busy) {
    if (picked) {
      const o = offers?.[picked];
      status(`Tap ${boxLabel(b.boxes.find(x => x.id === picked))} again to score ${o}.`);
    } else if (g.rolls === 0) status(g.number === 1 ? 'Your turn. Roll the dice.' : 'Your turn.');
    else if (left > 0) status('Tap dice to hold them, then roll again. Or pick a box to score.');
    else status('Pick a box to score.');
  }
}

function status(text) { $('status').textContent = text; }

function renderHome() {
  const list = $('tables');
  list.innerHTML = TABLES.map((t, i) => {
    const beaten = !!progress.beaten[i], unlocked = i === 0 || !!progress.beaten[i - 1];
    const state = beaten ? `Beaten${progress.best[i] ? ` · your best ${progress.best[i]}` : ''}` : unlocked ? 'Next up' : 'Locked';
    return `<li class="${beaten ? 'beaten' : unlocked ? 'next' : 'locked'}">
      <button type="button" data-table="${i}" ${unlocked ? '' : 'disabled'}>
        <span class="n">${i + 1}</span>
        <span class="txt"><b>${t.board.name}</b><span class="vs"><i class="dot" style="--c:${t.who.colour}"></i>${t.who.name}</span><small>${state}</small></span>
      </button></li>`;
  }).join('');
  const met = TABLES.map((t, i) => ({ t, i })).filter(({ i }) => i === 0 || progress.beaten[i - 1]);
  $('people').innerHTML = met.map(({ t, i }) => `<button type="button" data-quick="${i}"><i class="dot" style="--c:${t.who.colour}"></i>${t.who.name}</button>`).join('');
  const c = $('b-continue');
  c.hidden = !game;
  if (game) c.innerHTML = `<b>Carry on</b><span>${game.table === null ? 'Quick game' : `Table ${game.table + 1}: ${game.board.name}`}, against ${who(game).name}. Turn ${game.number} of ${game.board.boxes.length}.</span>`;
}

function open(screen) {
  document.body.dataset.screen = screen;
  if (screen === 'home') renderHome();
  window.scrollTo(0, 0);
}

// ---- sheets and messages ----

function intro(table) {
  const t = TABLES[table];
  $('intro-n').textContent = `Table ${table + 1} of ${TABLES.length}`;
  $('intro-title').textContent = t.board.name;
  $('intro-blurb').textContent = t.board.blurb;
  $('intro-who').innerHTML = `<i class="dot big" style="--c:${t.who.colour}">${t.who.name.replace(/^The /, '')[0]}</i><div><b>${t.who.name}</b><span>${t.who.line}</span>${game && !game.over ? '<em>Sitting down here ends the game you’re in.</em>' : ''}</div>`;
  $('b-sit').onclick = () => start(table);
  openSheet('sheet-intro');
}

let opener = null;
function openSheet(id) {
  closeSheets();
  opener = document.activeElement;
  $(id).hidden = false;
  $(id).querySelector('.primary, .close, button')?.focus({ preventScroll: true });
}
function closeSheets() {
  const shown = document.querySelectorAll('.sheet:not([hidden])');
  shown.forEach(s => { s.hidden = true; });
  if (shown.length && opener?.focus && document.contains(opener)) opener.focus({ preventScroll: true });
  opener = null;
}

let toastTimer = 0;
function toast(text) {
  const t = $('toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
}

const escape = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// ---- saving ----

function read() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify({ settings, progress, game: game && !game.over ? game : null })); } catch { /* storage full or blocked */ }
}

// ---- buttons ----

$('b-roll').addEventListener('click', roll);
$('b-home').addEventListener('click', () => open('home'));
$('b-continue').addEventListener('click', () => {
  open('game');
  showDice();
  render();
  if (game?.turn === 'them' && !busy) theirTurn();
});
$('tables').addEventListener('click', e => { const b = e.target.closest('[data-table]'); if (b) intro(+b.dataset.table); });
$('people').addEventListener('click', e => { const b = e.target.closest('[data-quick]'); if (b) start(null, +b.dataset.quick); });
$('b-tour').addEventListener('click', () => { closeSheets(); game = null; save(); open('home'); });
$('b-again').addEventListener('click', () => start(game.table, game.opp));
$('b-rules').addEventListener('click', () => openSheet('sheet-rules'));
const showMenu = () => {
  if (!game) return;
  $('menu-title').textContent = game.table === null ? 'Quick game' : `Table ${game.table + 1}: ${game.board.name}`;
  $('menu-twist').textContent = `${game.board.blurb} You’re playing ${who(game).name}: ${who(game).line.charAt(0).toLowerCase()}${who(game).line.slice(1)}`;
  openSheet('sheet-menu');
};
$('b-menu').addEventListener('click', showMenu);
$('b-where').addEventListener('click', showMenu);
$('b-concede').addEventListener('click', () => concede(false));
document.querySelectorAll('[data-close]').forEach(el => el.addEventListener('click', closeSheets));
for (const [k, id] of [['fast', 'o-fast'], ['hints', 'o-hints']]) {
  $(id).checked = settings[k];
  $(id).addEventListener('change', e => { settings[k] = e.target.checked; save(); render(); });
}
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeSheets(); return; }
  if (document.body.dataset.screen !== 'game' || document.querySelector('.sheet:not([hidden])')) return;
  if ((e.key === ' ' || e.key === 'r') && e.target === document.body) { e.preventDefault(); roll(); }
  if (/^[1-5]$/.test(e.key)) toggle(+e.key - 1);
});

// ---- offline ----

if ('serviceWorker' in navigator && !('single' in document.documentElement.dataset) && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// ---- starting up ----

open('home');
if (game) {
  // A game in progress comes back where you left it. An opponent's turn that was cut short starts over.
  open('game');
  showDice();
  render();
  if (game.turn === 'them') setTimeout(theirTurn, 500);
}

// For the tests and the screenshot tool.
window.fullHouse = {
  get game() { return game; },
  get busy() { return busy; },
  progress,
  settings,
  start,
  set(g) { token++; game = g; busy = false; picked = null; open('game'); showDice(); render(); if (g.turn === 'them') theirTurn(); },
};
