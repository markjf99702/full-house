// The dice tray: five dice drawn as real cubes, which tumble when rolled and land face up.
// Tapping a die holds it (or lets it go) on your turn.

// Which way to turn the cube so each face looks at you. Opposite faces add up to seven, as on real dice.
const FACE_TURN = { 1: [0, 0], 2: [0, -90], 3: [-90, 0], 4: [90, 0], 5: [0, 90], 6: [0, 180] };
// Where the pips sit on a 3 x 3 grid, numbered 0..8 left to right, top to bottom.
const PIPS = { 1: [4], 2: [2, 6], 3: [2, 4, 6], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };

export class Tray {
  // onToggle(i): the player tapped die i.
  constructor(el, { onToggle, onTap }) {
    this.el = el;
    this.dice = [];
    this.turns = [];
    for (let i = 0; i < 5; i++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'die';
      b.innerHTML = `<span class="hop"><span class="cube">${[1, 2, 3, 4, 5, 6].map(face).join('')}</span></span><span class="held-tag">Held</span>`;
      b.addEventListener('click', () => onToggle(i));
      el.append(b);
      this.dice.push(b);
      this.turns.push({ x: 0, y: 0 });
    }
    el.addEventListener('click', e => { if (!e.target.closest('.die')) onTap?.(); });
  }

  // Show these dice. `rolled` lists the ones that were just thrown, which tumble into place.
  show(values, held, { rolled = [], theirs = false, idle = false, canHold = false } = {}) {
    this.el.classList.toggle('theirs', theirs);
    this.el.classList.toggle('idle', idle);
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    values.forEach((v, i) => {
      const b = this.dice[i], t = this.turns[i], cube = b.querySelector('.cube'), hop = b.querySelector('.hop');
      const [fx, fy] = FACE_TURN[v];
      if (rolled.includes(i) && !still) {
        // Tumble forwards a turn or two on each axis, then settle on the new face.
        t.x = Math.ceil((t.x + 360) / 360) * 360 + 360 * Math.floor(Math.random() * 2) + fx;
        t.y = Math.ceil((t.y + 360) / 360) * 360 + 360 * Math.floor(Math.random() * 2) + fy;
        b.style.setProperty('--tilt', `${Math.round(Math.random() * 16 - 8)}deg`);
        b.style.setProperty('--nudge', `${Math.round(Math.random() * 8 - 4)}px`);
        hop.classList.remove('go');
        void hop.offsetWidth;
        hop.classList.add('go');
      } else if (rolled.includes(i) || !b.dataset.v) {
        t.x = Math.round(t.x / 360) * 360 + fx;
        t.y = Math.round(t.y / 360) * 360 + fy;
      }
      cube.style.transform = `rotateX(${t.x}deg) rotateY(${t.y}deg)`;
      b.dataset.v = v;
      b.classList.toggle('held', !!held[i]);
      b.disabled = !canHold;
      b.setAttribute('aria-pressed', String(!!held[i]));
      b.setAttribute('aria-label', `${v}${held[i] ? ', held' : ''}`);
    });
  }
}

function face(n) {
  const pips = Array.from({ length: 9 }, (_, k) => (PIPS[n].includes(k) ? '<i></i>' : '<b></b>')).join('');
  return `<span class="face f${n}">${pips}</span>`;
}
