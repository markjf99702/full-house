// The tour: eight tables, each with its own twist on the rules and a sharper opponent than the last.
// Beat an opponent to move on to the next table.

import { mulberry32 } from './rng.js';

const STANDARD = [
  { id: 'f1', kind: 'face', face: 1 }, { id: 'f2', kind: 'face', face: 2 }, { id: 'f3', kind: 'face', face: 3 },
  { id: 'f4', kind: 'face', face: 4 }, { id: 'f5', kind: 'face', face: 5 }, { id: 'f6', kind: 'face', face: 6 },
  { id: 'three', kind: 'three' }, { id: 'four', kind: 'four' }, { id: 'full', kind: 'full' },
  { id: 'small', kind: 'small' }, { id: 'large', kind: 'large' }, { id: 'five', kind: 'five' }, { id: 'chance', kind: 'chance' },
];

const base = { rolls: 3, wild: false, bonus: { at: 63, worth: 35 }, extra: 100 };
const boxes = (changes = {}) => STANDARD.map(b => ({ mult: 1, ...b, ...(changes[b.id] || {}) }));

export const CLASSIC = {
  ...base, id: 'classic', name: 'Classic',
  blurb: 'The game as it comes in the box. Score 63 in the top section for a 35-point bonus.',
  boxes: boxes(),
};

// Two boxes chosen at random score three times over, different every time you sit down.
function hotBoxes(seed) {
  const rand = mulberry32(seed);
  const pool = STANDARD.filter(b => b.kind !== 'five').map(b => b.id);
  const hot = [];
  while (hot.length < 2) {
    const id = pool[Math.floor(rand() * pool.length)];
    if (!hot.includes(id)) hot.push(id);
  }
  const changes = Object.fromEntries(hot.map(id => [id, { mult: 3 }]));
  const extra = STANDARD.filter(b => hot.includes(b.id) && b.kind === 'face').reduce((a, b) => a + 2 * 3 * b.face, 0);
  return { boxes: boxes(changes), bonus: { at: 63 + extra, worth: 35 } };
}

export const TABLES = [
  {
    board: CLASSIC,
    who: { name: 'Pip', line: 'New to the game. Keeps whatever there’s most of.', colour: '#5b8c5a' },
    play: { look: false, slip: 0.25 },
  },
  {
    board: {
      ...base, id: 'evens', name: 'Evens',
      blurb: 'There’s no Ones box. Evens takes its place: add up every even die. The top-section bonus needs 72.',
      boxes: boxes({ f1: { id: 'evens', kind: 'evens', face: undefined } }),
      bonus: { at: 72, worth: 35 },
    },
    who: { name: 'Maud', line: 'Plays it safe and takes the points in front of her.', colour: '#8a6d3b' },
    play: { patience: 0.35, bonus: 0.3, slip: 0.22 },
  },
  {
    board: {
      ...base, id: 'sixes', name: 'Triple Sixes',
      blurb: 'Sixes score three times over. The top-section bonus needs 99 to match.',
      boxes: boxes({ f6: { mult: 3 } }),
      bonus: { at: 99, worth: 35 },
    },
    who: { name: 'Bea', line: 'Never lets a six go to waste.', colour: '#b0503a' },
    play: { patience: 0.6, bonus: 0.6, slip: 0.16, style: { boost: { face: 1.1 } } },
  },
  {
    board: {
      ...base, id: 'two-rolls', name: 'Two Rolls',
      blurb: 'Only two rolls a turn instead of three. Every keep counts.',
      boxes: boxes(), rolls: 2,
    },
    who: { name: 'Sol', line: 'Quick hands. Loves a big Chance.', colour: '#3f6f9a' },
    play: { patience: 0.8, bonus: 0.8, slip: 0.12, style: { boost: { chance: 0.7 } } },
  },
  {
    board: {
      ...base, id: 'wild', name: 'Wild Ones',
      blurb: 'In the bottom section, every 1 counts as whatever number scores best. In the top section a 1 is just a 1.',
      boxes: boxes(), wild: true,
    },
    who: { name: 'Jules', line: 'Chases five of a kind, every time.', colour: '#7a4f8f' },
    play: { patience: 0.9, bonus: 0.8, slip: 0.08, style: { boost: { five: 1.8 } } },
  },
  {
    board: {
      ...base, id: 'hot', name: 'Hot Boxes',
      blurb: 'Two boxes, picked at random each time you sit down, score three times over.',
      hot: true,
    },
    who: { name: 'Otto', line: 'Steady. Rarely misses the bonus.', colour: '#2f7d74' },
    play: { patience: 1, bonus: 1.2, slip: 0.05 },
  },
  {
    board: {
      ...base, id: 'pairs', name: 'Pairs and the Low Road',
      blurb: 'Three of a kind becomes Two pairs: add up the four paired dice. Chance becomes the Low road: 30 if the dice total 12 or less.',
      boxes: boxes({ three: { id: 'pairs', kind: 'pairs' }, chance: { id: 'low', kind: 'low' } }),
    },
    who: { name: 'Wren', line: 'Sharp, and getting sharper.', colour: '#9a7a2f' },
    play: { patience: 1, bonus: 1, slip: 0.02 },
  },
  {
    board: {
      ...base, id: 'high', name: 'High Stakes',
      blurb: 'Four rolls a turn, and every box in the bottom section scores double.',
      boxes: boxes(Object.fromEntries(['three', 'four', 'full', 'small', 'large', 'five', 'chance'].map(id => [id, { mult: 2 }]))),
      rolls: 4,
    },
    who: { name: 'The Dealer', line: 'Hasn’t lost a game in years.', colour: '#3a3a44' },
    play: { patience: 1, bonus: 1, slip: 0 },
  },
];

// The board for a table, with anything random about it settled by the seed.
export function boardFor(table, seed) {
  const b = TABLES[table].board;
  return b.hot ? { ...b, ...hotBoxes(seed) } : b;
}
