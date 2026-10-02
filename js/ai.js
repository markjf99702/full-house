// How the opponents play.
//
// Five dice can only come up 252 different ways (counting 3-3-5-1-6 the same as 1-3-3-5-6), and what you can
// choose to keep from a roll is one of 462 smaller handfuls. So an opponent can work out exactly, for every roll,
// which dice to keep to do best over the rest of its turn, given how much it would value each box at the end.
// That valuation is where skill and style live: a good player counts what a box is worth later, chases the
// top-section bonus, and doesn't waste a five-of-a-kind box early. Weaker opponents leave some of that out and
// sometimes take the second-best choice.

import { options, isUpper, totals, turnsLeft } from './rules.js';

// ---- every roll, and every handful you might keep ----

const STATES = [], KEEPS = [];
const STATE_AT = new Map(), KEEP_AT = new Map();
const keyOf = c => c.slice(1).join('');

function multisets(n, from = 1, acc = []) {
  if (from > 6) return n === 0 ? [acc] : [];
  const out = [];
  for (let k = 0; k <= n; k++) out.push(...multisets(n - k, from + 1, [...acc, k]));
  return out;
}
for (const c of multisets(5)) {
  const counts = [0, ...c];
  STATE_AT.set(keyOf(counts), STATES.length);
  STATES.push({ counts, dice: counts.flatMap((n, f) => Array(n).fill(f)) });
}
for (let size = 0; size <= 5; size++) {
  for (const c of multisets(size)) {
    const counts = [0, ...c];
    KEEP_AT.set(keyOf(counts), KEEPS.length);
    KEEPS.push({ counts, size });
  }
}

const FACT = [1, 1, 2, 6, 24, 120];
// For each handful kept: the rolls you could end up with after rolling the rest, and how likely each is.
const OUTCOMES = KEEPS.map(k => {
  const m = 5 - k.size, out = [];
  for (const c of multisets(m)) {
    let p = FACT[m] / 6 ** m;
    for (const n of c) p /= FACT[n];
    const counts = k.counts.map((n, f) => (f ? n + c[f - 1] : 0));
    out.push([STATE_AT.get(keyOf(counts)), p]);
  }
  return out;
});
// For each roll: every handful you could keep from it.
const SUBSETS = STATES.map(s => {
  let list = [[0]];
  for (let f = 1; f <= 6; f++) list = list.flatMap(acc => Array.from({ length: s.counts[f] + 1 }, (_, n) => [...acc, n]));
  return list.map(c => KEEP_AT.get(keyOf(c)));
});

export const stateOf = dice => {
  const c = [0, 0, 0, 0, 0, 0, 0];
  for (const d of dice) c[d]++;
  return STATE_AT.get(keyOf(c));
};

// ---- what a box is worth ----

// Roughly what each kind of box scores in a well-played game, before its multiplier: what you give up by using it now.
const TYPICAL = { face: f => 2.6 * f, evens: () => 13, odds: () => 10, three: () => 16, four: () => 9, full: () => 19, small: () => 23, large: () => 24, five: () => 14, chance: () => 21, pairs: () => 14, low: () => 9 };
// A score that keeps the top-section bonus on track: three of the number.
const PAR = { face: b => 3 * b.face, evens: () => 12, odds: () => 9 };

function typical(box, p) {
  let t = (p.typical?.[box.kind] ?? TYPICAL[box.kind](box.face)) * (box.kind === 'face' && p.typical?.face ? box.face : 1) * (box.mult || 1);
  if (p.style.boost?.[box.kind]) t *= p.style.boost[box.kind];
  return t;
}

// How much keeping a box open is worth with n turns left, this one included. Nothing on the last turn.
const LATER = (n, tau) => (1 - Math.exp(-(n - 1) / tau)) / (1 - Math.exp(-12 / tau));

function valuer(board, card, p) {
  const n = turnsLeft(board, card);
  const t = totals(board, card);
  const upperOpen = board.boxes.filter(b => isUpper(b) && card[b.id] === null);
  const parLeft = upperOpen.reduce((a, b) => a + PAR[b.kind](b) * (b.mult || 1), 0);
  const need = board.bonus.at - t.upper;
  const later = LATER(n, p.tau);
  return opt => {
    const b = opt.box;
    let v = opt.score + opt.extra;
    v -= p.patience * typical(b, p) * later;
    if (isUpper(b) && need > 0 && p.bonus) {
      if (opt.score >= need) v += board.bonus.worth * p.bonus;
      else {
        // Ahead of par or behind it, weighted by how much the bonus is still in reach.
        const par = PAR[b.kind](b) * (b.mult || 1);
        const reach = Math.max(0, Math.min(1, (parLeft + 6 - need) / 12 + 0.5));
        v += p.bonus * reach * (opt.score - par) * (board.bonus.worth / board.bonus.at) * p.pull;
      }
    }
    return v;
  };
}

// ---- planning a turn ----


// Best box value for every possible roll, then, working back, what each handful is worth with r rolls to come.
function plan(board, card, rolls, p) {
  const value = valuer(board, card, p);
  const v0 = STATES.map(s => {
    const opts = options(board, card, s.dice);
    let best = -Infinity;
    for (const o of opts) best = Math.max(best, value(o));
    return best;
  });
  const keepValues = [];
  let v = v0;
  for (let r = 1; r <= rolls; r++) {
    const k = OUTCOMES.map(out => { let a = 0; for (const [s, q] of out) a += q * v[s]; return a; });
    keepValues[r] = k;
    v = SUBSETS.map(subs => { let best = -Infinity; for (const i of subs) if (k[i] > best) best = k[i]; return best; });
  }
  return keepValues;
}

// ---- the opponents ----

// Settings for an opponent:
//   look      plans its keeps (true) or just keeps whatever there's most of (false)
//   patience  0..1, how much it counts what a box is worth later
//   bonus     0..1, how much it chases the top-section bonus
//   slip      chance of taking the second-best choice at any point
//   tau       how quickly boxes lose their worth for later as the game runs out
//   style     { boost: { kind: factor } }, boxes it likes more (or less) than they're worth
export class Opponent {
  constructor(p) {
    this.p = { look: true, patience: 1, bonus: 1, slip: 0, tau: 6, pull: 4, style: {}, ...p };
  }

  // Which dice to keep before rolling again, as true/false for each die. Null means stop and score now.
  keep(board, card, dice, rollsLeft, rand = Math.random) {
    if (rollsLeft <= 0) return null;
    if (!this.p.look) return this.greedyKeep(board, card, dice);
    const k = plan(board, card, rollsLeft, this.p)[rollsLeft];
    const ranked = [...new Set(SUBSETS[stateOf(dice)])].sort((a, b) => k[b] - k[a]);
    const pick = ranked.length > 1 && rand() < this.p.slip ? ranked[1] : ranked[0];
    const kept = KEEPS[pick];
    if (kept.size === 5) return null;
    return markKept(dice, kept.counts);
  }

  // Which box to score in.
  box(board, card, dice, rand = Math.random) {
    const opts = options(board, card, dice);
    const value = this.p.look ? valuer(board, card, this.p) : o => o.score + o.extra - (o.box.kind === 'five' ? 30 : 0);
    const ranked = opts.map(o => ({ o, v: value(o) })).sort((a, b) => b.v - a.v);
    return (ranked.length > 1 && rand() < this.p.slip ? ranked[1] : ranked[0]).o;
  }

  // The beginner's way: keep the most common number (the higher one in a tie).
  greedyKeep(board, card, dice) {
    const c = [0, 0, 0, 0, 0, 0, 0];
    for (const d of dice) c[d]++;
    let face = 6;
    for (let f = 6; f >= 1; f--) if (c[f] > c[face]) face = f;
    if (c[face] === 5) return null;
    return dice.map(d => d === face);
  }
}

// Turn a handful (counts of each number) back into which of these dice to keep.
function markKept(dice, counts) {
  const left = counts.slice();
  return dice.map(d => (left[d] > 0 ? (left[d]--, true) : false));
}

// Play a whole turn without showing it: for tests and for checking how strong each opponent is.
export function playTurn(opp, board, card, rand = Math.random) {
  let dice = Array.from({ length: 5 }, () => 1 + Math.floor(rand() * 6));
  for (let r = board.rolls - 1; r > 0; r--) {
    const keep = opp.keep(board, card, dice, r, rand);
    if (!keep) break;
    dice = dice.map((d, i) => (keep[i] ? d : 1 + Math.floor(rand() * 6)));
  }
  return { dice, option: opp.box(board, card, dice, rand) };
}
