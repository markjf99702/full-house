// The rules, the tables and the opponents, checked in Node:  node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import { score, options, blankCard, mark, totals, filled, fiveOf } from '../js/rules.js';
import { TABLES, CLASSIC, boardFor } from '../js/tour.js';
import { Opponent, playTurn } from '../js/ai.js';
import { mulberry32 } from '../js/rng.js';

const box = (board, id) => board.boxes.find(b => b.id === id);
const s = (id, dice, board = CLASSIC) => score(board, box(board, id), dice);

test('the classic boxes score as on the pad', () => {
  assert.equal(s('f3', [3, 3, 1, 3, 6]), 9);
  assert.equal(s('three', [5, 5, 5, 1, 2]), 18);
  assert.equal(s('three', [5, 5, 4, 1, 2]), 0);
  assert.equal(s('four', [2, 2, 2, 2, 6]), 14);
  assert.equal(s('full', [2, 2, 3, 3, 3]), 25);
  assert.equal(s('full', [3, 3, 3, 3, 3]), 0, 'five of a kind is not a full house by itself');
  assert.equal(s('small', [1, 2, 3, 4, 6]), 30);
  assert.equal(s('small', [3, 4, 5, 6, 6]), 30);
  assert.equal(s('small', [1, 2, 3, 5, 6]), 0);
  assert.equal(s('large', [2, 3, 4, 5, 6]), 40);
  assert.equal(s('large', [1, 2, 3, 4, 6]), 0);
  assert.equal(s('five', [4, 4, 4, 4, 4]), 50);
  assert.equal(s('chance', [6, 5, 4, 3, 1]), 19);
});

test('the top-section bonus comes at 63, and the totals add up', () => {
  let card = blankCard(CLASSIC);
  for (const [id, v] of [['f1', 3], ['f2', 6], ['f3', 9], ['f4', 12], ['f5', 15], ['f6', 18]]) card = mark(card, { box: box(CLASSIC, id), score: v, extra: 0 });
  card = mark(card, { box: box(CLASSIC, 'chance'), score: 22, extra: 0 });
  assert.deepEqual(totals(CLASSIC, card), { upper: 63, bonus: 35, lower: 22, extras: 0, total: 120 });
});

test('a second five of a kind: the extra bonus, then the joker rules', () => {
  let card = blankCard(CLASSIC);
  card = mark(card, { box: box(CLASSIC, 'five'), score: 50, extra: 0 });
  // Its own number's box is open, so it must go there.
  let opts = options(CLASSIC, card, [4, 4, 4, 4, 4]);
  assert.deepEqual(opts.map(o => [o.box.id, o.score, o.extra]), [['f4', 20, 100]]);
  // With that box filled, any bottom box, and a full house or straight counts in full.
  card = mark(card, { box: box(CLASSIC, 'f4'), score: 8, extra: 0 });
  opts = options(CLASSIC, card, [4, 4, 4, 4, 4]);
  const by = Object.fromEntries(opts.map(o => [o.box.id, o.score]));
  assert.deepEqual(by, { three: 20, four: 20, full: 25, small: 30, large: 40, chance: 20 });
  assert.ok(opts.every(o => o.extra === 100));
  // No bonus if the five-of-a-kind box was crossed out with a zero.
  const zeroed = mark(blankCard(CLASSIC), { box: box(CLASSIC, 'five'), score: 0, extra: 0 });
  assert.ok(options(CLASSIC, zeroed, [2, 2, 2, 2, 2]).every(o => o.extra === 0));
  card = mark(card, opts.find(o => o.box.id === 'large'));
  assert.equal(totals(CLASSIC, card).extras, 100);
});

test('wild ones count as whatever scores best, but only in the bottom section', () => {
  const wild = TABLES[4].board;
  assert.equal(wild.wild, true);
  assert.equal(s('f1', [1, 1, 3, 4, 5], wild), 2, 'a 1 is a 1 on top');
  assert.equal(s('large', [1, 2, 3, 5, 6], wild), 40, 'the 1 fills the 4');
  assert.equal(s('full', [1, 1, 3, 3, 6], wild), 25);
  assert.equal(s('five', [1, 6, 6, 1, 6], wild), 50);
  assert.equal(s('four', [1, 6, 6, 2, 6], wild), 26, 'the 1 counts as a 6');
  assert.equal(fiveOf(wild, [1, 6, 6, 1, 6]), 0, 'only a true five of a kind earns the extra bonus');
});

test('every table is a complete board; the twists are what they say', () => {
  for (const t of TABLES) {
    const b = boardFor(TABLES.indexOf(t), 7);
    assert.equal(b.boxes.length, 13, t.board.name);
    assert.equal(new Set(b.boxes.map(x => x.id)).size, 13, t.board.name);
    assert.ok(b.boxes.some(x => x.kind === 'five'), t.board.name);
  }
  const evens = TABLES[1].board;
  assert.equal(s('evens', [2, 4, 4, 5, 1], evens), 10);
  assert.equal(s('f6', [6, 6, 1, 2, 3], TABLES[2].board), 36, 'triple sixes');
  assert.equal(TABLES[3].board.rolls, 2);
  const pairs = TABLES[6].board;
  assert.equal(s('pairs', [5, 5, 3, 3, 1], pairs), 16);
  assert.equal(s('pairs', [5, 5, 5, 3, 1], pairs), 0);
  assert.equal(s('low', [1, 2, 3, 2, 4], pairs), 30);
  assert.equal(s('low', [6, 2, 3, 2, 4], pairs), 0);
  // Hot boxes: two boxes at three times, the same two for the same seed.
  const hot = boardFor(5, 42), again = boardFor(5, 42);
  assert.equal(hot.boxes.filter(x => x.mult === 3).length, 2);
  assert.deepEqual(hot.boxes, again.boxes);
  const hotTop = hot.boxes.filter(x => x.mult === 3 && x.kind === 'face');
  assert.equal(hot.bonus.at, 63 + hotTop.reduce((a, x) => a + 6 * x.face, 0));
});

test('opponents only ever score where the rules allow, and fill the card in thirteen turns', () => {
  const rand = mulberry32(3);
  for (const t of [0, 4, 7]) {
    const board = boardFor(t, 1), opp = new Opponent(TABLES[t].play);
    let card = blankCard(board), turns = 0;
    while (!filled(board, card)) {
      const { dice, option } = playTurn(opp, board, card, rand);
      assert.ok(options(board, card, dice).some(o => o.box.id === option.box.id && o.score === option.score));
      card = mark(card, option);
      turns++;
    }
    assert.equal(turns, 13);
  }
});

test('the opponents get better as the tour goes on', () => {
  const avg = (play, games = 60) => {
    const rand = mulberry32(11), opp = new Opponent(play);
    let sum = 0;
    for (let g = 0; g < games; g++) {
      let card = blankCard(CLASSIC);
      while (!filled(CLASSIC, card)) card = mark(card, playTurn(opp, CLASSIC, card, rand).option);
      sum += totals(CLASSIC, card).total;
    }
    return sum / games;
  };
  const pip = avg(TABLES[0].play), maud = avg(TABLES[1].play), dealer = avg(TABLES[7].play);
  assert.ok(pip < maud && maud < dealer, `${pip} < ${maud} < ${dealer}`);
  assert.ok(dealer > 220, `the Dealer averages ${dealer}`);
  assert.ok(pip < 170, `Pip averages ${pip}`);
});
