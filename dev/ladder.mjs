// How hard is each table of the tour? Plays each table's opponent, a rule-of-thumb player and the opponents' own
// planner at its best settings, and prints how often each player beats the opponent at that table.
//   node dev/ladder.mjs [games]        or  npm run sim
// The rule-of-thumb player stands in for a person who knows the game: it stops on a made hand, goes for a straight
// with four in a row, for more of a number with three or more, for a full house with two pairs, keeps a pair or a
// high die, and scores where the dice beat what that box usually scores by the most, minding the top-section bonus.
// It reads the table too: multipliers, wild ones, Evens, Two pairs and the Low road.
import { options, isUpper, totals, turnsLeft, blankCard, mark, filled } from '../js/rules.js';
import { TABLES, boardFor } from '../js/tour.js';
import { Opponent, playTurn } from '../js/ai.js';
import { mulberry32 } from '../js/rng.js';

const GAMES = +(process.argv[2] || 400);

const countsOf = dice => { const c = [0, 0, 0, 0, 0, 0, 0]; for (const d of dice) c[d]++; return c; };
const keepCounts = (dice, counts) => { const left = counts.slice(); return dice.map(d => (left[d] > 0 ? (left[d]--, true) : false)); };
// What a box usually scores for someone playing this way, before its multiplier; the top boxes go by par.
const USUAL = { evens: 15, odds: 9, three: 17, four: 10, full: 21, small: 25, large: 28, five: 14, chance: 21, pairs: 14, low: 14 };
const par = b => (b.kind === 'face' ? 3 * b.face : b.kind === 'evens' ? 12 : b.kind === 'odds' ? 9 : 0) * (b.mult || 1);

const ruleOfThumb = {
  keep(board, card, dice, rollsLeft) {
    if (rollsLeft <= 0) return null;
    const open = board.boxes.filter(b => card[b.id] === null), has = kind => open.some(b => b.kind === kind);
    const openFace = f => open.some(b => b.kind === 'face' && b.face === f);
    const opts = options(board, card, dice), got = kind => opts.some(o => o.box.kind === kind && o.score > 0);
    const c = countsOf(dice), wild = board.wild;
    // A made hand: stop. With wild ones a full house comes too easily to stop for.
    if (opts.some(o => o.extra > 0) || got('five') || got('large') || (got('small') && !has('large'))) return null;
    if ((!wild && got('full')) || (got('low') && !has('small') && !has('large'))) return null;

    // Straights: the best run of four (or five) numbers, with wild ones filling gaps.
    const run = len => {
      let best = null;
      for (let s = 1; s + len - 1 <= 6; s++) {
        const faces = [], gaps = [];
        for (let f = s; f < s + len; f++) ((wild ? f !== 1 && c[f] : c[f]) ? faces : gaps).push(f);
        const fill = wild ? Math.min(c[1], gaps.length) : 0, n = faces.length + fill;
        if (!best || n > best.n || (n === best.n && s > best.s)) best = { n, s, faces, fill };
      }
      return best;
    };
    const keepRun = r => keepCounts(dice, countsOf([...r.faces, ...Array(r.fill).fill(1)]));
    const r4 = run(4);
    if (has('large') && r4.n >= 4) { const r5 = run(5); return keepRun(r5.n >= 4 ? r5 : r4); }

    // Of a kind: the number there's most of, with wild ones counted in while the bottom section can use them.
    const ofAKind = ['three', 'four', 'five', 'full', 'pairs'].some(has);
    const wildFor = f => wild && ofAKind && f !== 1;
    let face = 0, best = -1;
    for (let f = 6; f >= 1; f--) {
      if (wild && ofAKind && f === 1) continue;
      const n = c[f] + (wildFor(f) ? c[1] : 0), useful = openFace(f) || ofAKind;
      const score = n * 10 + (openFace(f) ? 2 : 0) + f / 10 - (useful ? 0 : 100);
      if (score > best) { best = score; face = f; }
    }
    const n = openFace(face) || ofAKind ? c[face] + (wildFor(face) ? c[1] : 0) : 0;
    // Only five dice showing the same number earn the extra 100, so once Five of a kind has scored, three or more of
    // a number go for five real ones and let the wild ones go.
    const fiveBox = board.boxes.find(b => b.kind === 'five');
    const realFive = wild && card[fiveBox.id] > 0 && c[face] >= 3;
    const keepFace = () => dice.map(d => d === face || (wildFor(face) && !realFive && d === 1));
    if (n >= 3) return n === 5 && !realFive ? null : keepFace();

    // Two pairs go for a full house (or Two pairs), three in a row for a straight, and on the tables with them,
    // three even dice for Evens and three ones and twos for the Low road.
    const pairs = [1, 2, 3, 4, 5, 6].filter(f => c[f] >= 2);
    if (pairs.length >= 2 && (has('full') || has('pairs'))) return dice.map(d => pairs.includes(d));
    const r3 = run(3);
    if ((has('small') || has('large')) && r3.n >= 3 && n <= 2 && r4.n >= 3) return keepRun(r4.n >= 4 ? r4 : r3);
    if (has('evens') && c[2] + c[4] + c[6] >= 3) return dice.map(d => d % 2 === 0);
    if (has('low') && c[1] + c[2] >= 3) return dice.map(d => d <= 2);
    // A pair, or else a high die for the boxes that add up the dice, or roll them all.
    if (n === 2) return keepFace();
    const hi = Math.max(...dice);
    if (hi >= 5) { let kept = false; return dice.map(d => (d === hi && !kept ? (kept = true) : false)); }
    return dice.map(() => false);
  },

  box(board, card, dice) {
    const later = (turnsLeft(board, card) - 1) / 12, need = board.bonus.at - totals(board, card).upper;
    let best = null, most = -Infinity;
    for (const o of options(board, card, dice)) {
      const b = o.box;
      let v = o.score + o.extra - later * (isUpper(b) ? par(b) : USUAL[b.kind] * (b.mult || 1));
      if (isUpper(b) && need > 0) v += o.score >= need ? 0.8 * board.bonus.worth : 1.5 * (o.score - par(b));
      if (v > most) { most = v; best = o; }
    }
    return best;
  },
};

// Game g at a table is played on boardFor(table, g), so at Hot Boxes everyone's game g has the same hot boxes.
function play(player, table, games, who) {
  const out = [];
  for (let g = 0; g < games; g++) {
    const board = boardFor(table, g), rand = mulberry32((who * 7919 + table * 104729 + g) >>> 0);
    let card = blankCard(board);
    while (!filled(board, card)) card = mark(card, playTurn(player, board, card, rand).option);
    out.push(totals(board, card).total);
  }
  return out;
}

// How often a total from `mine` beats one from `theirs` (a tie is a replay, so it isn't a win), and the margin of a
// 95% interval: every game against every game on a fixed table (Hanley and McNeil's interval), game g against game g
// at Hot Boxes.
function wins(mine, theirs, sameBoards) {
  const m = mine.length, n = theirs.length;
  if (sameBoards) { const p = mine.filter((x, g) => x > theirs[g]).length / m; return { p, margin: 1.96 * Math.sqrt((p * (1 - p)) / m) }; }
  const sorted = [...theirs].sort((a, b) => a - b);
  let won = 0;
  for (const x of mine) {
    let lo = 0, hi = n;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < x) lo = mid + 1; else hi = mid; }
    won += lo;
  }
  const p = won / (m * n), q1 = p / (2 - p), q2 = (2 * p * p) / (1 + p);
  return { p, margin: 1.96 * Math.sqrt((p * (1 - p) + (m - 1) * (q1 - p * p) + (n - 1) * (q2 - p * p)) / (m * n)) };
}

const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const players = [['rule of thumb', ruleOfThumb, GAMES], ['planner at its best', new Opponent({ patience: 1, bonus: 1, slip: 0 }), Math.ceil(GAMES / 4)]];
console.log(`${GAMES} games of each opponent and the rule-of-thumb player, ${players[1][2]} of the planner, at each table.\n`);
console.log(`${'table'.padEnd(26)} ${'opponent'.padEnd(11)} ${'mean'.padStart(5)}   ${players.map(([name]) => name.padEnd(24)).join('')}`);
const clear = players.map(() => 0);
for (let t = 0; t < TABLES.length; t++) {
  const { board, who, play: settings } = TABLES[t];
  const theirs = play(new Opponent(settings), t, GAMES, 1);
  const cells = players.map(([, player, games], i) => {
    const mine = play(player, t, games, 2 + i);
    const { p, margin } = board.hot ? wins(mine, theirs.slice(0, games), true) : wins(mine, theirs, false);
    clear[i] += 1 / p;
    return `${(100 * p).toFixed(0)}% ±${(100 * margin).toFixed(0)} (mean ${mean(mine).toFixed(0)})`.padEnd(24);
  });
  console.log(`${`${t + 1}. ${board.name}`.padEnd(26)} ${who.name.padEnd(11)} ${mean(theirs).toFixed(0).padStart(5)}   ${cells.join('')}`);
}
console.log(`\nGames to clear the whole tour, on average: ${players.map(([name], i) => `${name} ${clear[i].toFixed(1)}`).join(', ')}.`);
