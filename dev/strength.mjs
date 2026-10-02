// How strong is each opponent? Plays many games alone on each table and reports average totals.
//   node dev/strength.mjs [games] [table index or 'all'] [tau]
import { Opponent, playTurn } from '../js/ai.js';
import { TABLES, boardFor } from '../js/tour.js';
import { blankCard, mark, totals, filled } from '../js/rules.js';
import { mulberry32 } from '../js/rng.js';

const GAMES = +(process.argv[2] || 200), WHICH = process.argv[3] ?? 'all';
const tables = WHICH === 'all' ? TABLES.map((_, i) => i) : [+WHICH];

export function solo(opp, board, rand) {
  let card = blankCard(board);
  while (!filled(board, card)) card = mark(card, playTurn(opp, board, card, rand).option);
  return totals(board, card);
}

for (const t of tables) {
  const row = [];
  for (const [label, play] of [['own', TABLES[t].play], ['best', { patience: 1, bonus: 1, slip: 0 }]]) {
    const opp = new Opponent(play), rand = mulberry32(1000 + t);
    let sum = 0, bonus = 0, t0 = performance.now();
    for (let g = 0; g < GAMES; g++) {
      const r = solo(opp, boardFor(t, g), rand);
      sum += r.total; bonus += r.bonus > 0;
    }
    row.push(`${label} ${(sum / GAMES).toFixed(1)} (bonus ${Math.round((100 * bonus) / GAMES)}%, ${((performance.now() - t0) / GAMES).toFixed(0)} ms/game)`);
  }
  console.log(`${t + 1}. ${TABLES[t].board.name.padEnd(24)} ${TABLES[t].who.name.padEnd(11)} ${row.join('   ')}`);
}
