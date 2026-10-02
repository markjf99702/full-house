// The score pad: a printed form with your column and your opponent's, scores pencilled in.
// On your turn, the open boxes show what the dice would score there; tap one to pick it, and again to write it in.

import { boxLabel, boxHint, isUpper, totals } from './rules.js';

export class Pad {
  // onPick(boxId): the player tapped a box in their column.
  constructor(el, { onPick }) {
    this.el = el;
    this.onPick = onPick;
    el.addEventListener('click', e => {
      const row = e.target.closest('tr[data-box]');
      if (row && row.classList.contains('can')) onPick(row.dataset.box);
    });
    el.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const row = e.target.closest('tr[data-box]');
      if (row && row.classList.contains('can')) { e.preventDefault(); onPick(row.dataset.box); }
    });
  }

  // board, both cards, the opponent's name, and on your turn: what each allowed box would score ({ id: score }),
  // which box is picked, and which boxes were just written in (to pencil them in as you watch).
  render({ board, you, them, name, offers = null, picked = null, fresh = {}, hints = true, theirPick = null }) {
    const ty = totals(board, you), tt = totals(board, them);
    const cell = (card, b, who) => {
      const v = card[b.id];
      if (v !== null) return `<td class="${who}${fresh[who] === b.id ? ' fresh' : ''}"><span>${v}</span></td>`;
      if (who === 'you' && offers && b.id in offers) {
        const show = hints || picked === b.id;
        return `<td class="you offer${picked === b.id ? ' picked' : ''}">${show ? `<span>${offers[b.id]}</span>` : ''}</td>`;
      }
      if (who === 'them' && theirPick?.id === b.id) return `<td class="them offer picked"><span>${theirPick.score}</span></td>`;
      return `<td class="${who}"></td>`;
    };
    const row = b => {
      const can = offers && b.id in offers;
      const mult = b.mult > 1 ? `<em class="mult">×${b.mult}</em>` : '';
      return `<tr data-box="${b.id}" class="${can ? 'can' : ''}${picked === b.id ? ' picked' : ''}${b.mult > 1 ? ' hot' : ''}"${can ? ' tabindex="0" role="button"' : ''}>
        <th scope="row"><b>${boxLabel(b)}${mult}</b>${boxHint(b) ? `<small>${boxHint(b)}</small>` : ''}</th>${cell(you, b, 'you')}${cell(them, b, 'them')}</tr>`;
    };
    const upper = board.boxes.filter(isUpper), lower = board.boxes.filter(b => !isUpper(b));
    const bonusCell = t => `<td>${t.bonus ? t.bonus : t.upper >= 0 ? `<small>${t.upper}/${board.bonus.at}</small>` : ''}</td>`;
    const anyExtras = you.extras || them.extras;
    this.el.innerHTML = `
      <thead><tr><th scope="col"><span class="vh">Box</span></th><th scope="col" class="you">You</th><th scope="col" class="them">${escape(name)}</th></tr></thead>
      <tbody>${upper.map(row).join('')}
        <tr class="sub"><th scope="row"><b>Bonus</b><small>${board.bonus.at} or more on top: ${board.bonus.worth}</small></th>${bonusCell(ty)}${bonusCell(tt)}</tr>
      </tbody>
      <tbody>${lower.map(row).join('')}
        ${anyExtras ? `<tr class="sub"><th scope="row"><b>Extra fives</b><small>${board.extra} each</small></th><td>${ty.extras || ''}</td><td>${tt.extras || ''}</td></tr>` : ''}
      </tbody>
      <tfoot><tr class="total"><th scope="row">Total</th><td class="you">${ty.total}</td><td class="them">${tt.total}</td></tr></tfoot>`;
  }
}

const escape = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
