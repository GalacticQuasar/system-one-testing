// Rule-changing arcade: game logic and the steering controller. No DOM, so the
// page and the headless bench run the same simulation.
//
// Split of work:
//   - classifier (model / oracle / random) labels each object for the current
//     rule: collect | avoid | ignore, with probabilities.
//   - steering (plain code, below) turns those labels into movement.
// The model never sees positions or velocities; the steering never reads rules.

import { RULES, randomTraits } from './world.js';

export const W = 800, H = 500;
export const WAVE_S = 25;

const PLAYER_R = 14;
const PLAYER_MAX_V = 280;   // px/s
const PLAYER_ACCEL = 1400;  // px/s²
const SPAWN_EVERY = [0.7, 1.3];
const MAX_OBJECTS = 10;
const POINTS = { collect: 10, avoid: -20, ignore: 0 };

const rand = (a, b) => a + Math.random() * (b - a);

function shuffled(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

let nextObjectId = 1;

export function createGame() {
  const g = {
    t: 0,
    score: 0,
    player: { x: W / 2, y: H / 2, vx: 0, vy: 0, r: PLAYER_R },
    objects: [],
    labels: new Map(),      // object id → { wave, label, probabilities }
    deck: shuffled(RULES),
    wave: 0,
    rule: null,
    waveT: 0,
    spawnIn: 0.5,
    stats: newStats(),
    waveStats: [],
    events: [],             // touch events for the UI log
  };
  startWave(g);
  return g;
}

function newStats() {
  return { good: 0, bad: 0, neutral: 0, missed: 0, spawned: 0, labelled: 0, labelledRight: 0 };
}

function startWave(g) {
  if (g.rule) g.waveStats.push({ rule: g.rule.text, ...g.stats, score: g.waveScore });
  g.wave++;
  if (!g.deck.length) g.deck = shuffled(RULES);
  g.rule = g.deck.pop();
  g.waveT = 0;
  g.waveScore = 0;
  g.stats = newStats();
  // Objects already on screen keep their old labels until reclassified for the
  // new rule; the steering treats them as unknown in the meantime.
}

function spawn(g) {
  const traits = randomTraits();
  const r = traits.size === 'small' ? 11 : 18;
  const speed = traits.fast ? rand(140, 190) : rand(55, 85);
  // Enter from a random edge, aimed at a point near the middle.
  const side = Math.floor(Math.random() * 4);
  const x = side === 0 ? -r : side === 1 ? W + r : rand(0, W);
  const y = side === 2 ? -r : side === 3 ? H + r : rand(0, H);
  const tx = W / 2 + rand(-220, 220), ty = H / 2 + rand(-140, 140);
  const d = Math.hypot(tx - x, ty - y);
  g.objects.push({ id: nextObjectId++, ...traits, x, y, r, vx: (tx - x) / d * speed, vy: (ty - y) / d * speed, wave: g.wave });
  g.stats.spawned++;
}

// Current-wave label for an object, or null if not yet classified for this rule.
export function labelOf(g, o) {
  const l = g.labels.get(o.id);
  return l && l.wave === g.wave ? l : null;
}

export function setLabel(g, o, label, probabilities) {
  g.labels.set(o.id, { wave: g.wave, label, probabilities });
  g.stats.labelled++;
  if (label === g.rule.truth(o)) g.stats.labelledRight++;
}

// Expected points for touching an object, from the classifier's probabilities.
// With POINTS above, it's only worth chasing when P(collect) clearly beats
// 2 × P(avoid): this is where calibrated probabilities pay off.
function expected(l) {
  const p = l.probabilities;
  return POINTS.collect * (p.collect || 0) + POINTS.avoid * (p.avoid || 0);
}

// Potential-field steering: chase the best positive-EV object, keep away from
// anything negative-EV or not yet classified, stay off the walls.
export function steer(g) {
  const pl = g.player;
  let fx = 0, fy = 0;
  let best = null, bestScore = 0;
  for (const o of g.objects) {
    const dx = o.x - pl.x, dy = o.y - pl.y;
    const d = Math.hypot(dx, dy) || 1;
    const l = labelOf(g, o);
    const ev = l ? expected(l) : -10;  // unknown: assume it might be bad
    if (ev > 2) {
      const s = ev / (d + 60);
      if (s > bestScore) { bestScore = s; best = o; }
    } else if (ev < -2 || !l) {
      const R = o.r + PLAYER_R + 70;
      if (d < R) {
        const push = ((R - d) / R) ** 2 * 6;
        fx -= dx / d * push; fy -= dy / d * push;
      }
    }
  }
  if (best) {
    // Lead the target a little.
    const tx = best.x + best.vx * 0.25 - pl.x, ty = best.y + best.vy * 0.25 - pl.y;
    const d = Math.hypot(tx, ty) || 1;
    fx += tx / d * 1.5; fy += ty / d * 1.5;
  } else {
    fx += (W / 2 - pl.x) / W; fy += (H / 2 - pl.y) / H;  // drift home
  }
  const m = 60;
  if (pl.x < m) fx += (m - pl.x) / m * 3;
  if (pl.x > W - m) fx -= (pl.x - (W - m)) / m * 3;
  if (pl.y < m) fy += (m - pl.y) / m * 3;
  if (pl.y > H - m) fy -= (pl.y - (H - m)) / m * 3;
  return { fx, fy };
}

// `move` is a desired direction {fx, fy} (from steer() or the keyboard).
export function step(g, dt, move) {
  g.t += dt;
  g.waveT += dt;
  if (g.waveT >= WAVE_S) startWave(g);

  const pl = g.player;
  const m = Math.hypot(move.fx, move.fy);
  const dvx = m > 0.01 ? move.fx / m * PLAYER_MAX_V : 0, dvy = m > 0.01 ? move.fy / m * PLAYER_MAX_V : 0;
  const ax = dvx - pl.vx, ay = dvy - pl.vy, am = Math.hypot(ax, ay);
  const k = am > PLAYER_ACCEL * dt ? PLAYER_ACCEL * dt / am : 1;
  pl.vx += ax * k; pl.vy += ay * k;
  pl.x = Math.min(W - pl.r, Math.max(pl.r, pl.x + pl.vx * dt));
  pl.y = Math.min(H - pl.r, Math.max(pl.r, pl.y + pl.vy * dt));

  g.spawnIn -= dt;
  if (g.spawnIn <= 0 && g.objects.length < MAX_OBJECTS) { spawn(g); g.spawnIn = rand(...SPAWN_EVERY); }

  const keep = [];
  for (const o of g.objects) {
    o.x += o.vx * dt; o.y += o.vy * dt;
    const truth = g.rule.truth(o);
    if (Math.hypot(o.x - pl.x, o.y - pl.y) < o.r + pl.r) {
      const pts = POINTS[truth];
      g.score += pts; g.waveScore += pts;
      if (truth === 'collect') g.stats.good++;
      else if (truth === 'avoid') g.stats.bad++;
      else g.stats.neutral++;
      g.events.push({ t: g.t, o, truth, pts });
      g.labels.delete(o.id);
      continue;
    }
    const gone = o.x < -60 || o.x > W + 60 || o.y < -60 || o.y > H + 60;
    if (gone) {
      if (truth === 'collect') g.stats.missed++;
      g.labels.delete(o.id);
      continue;
    }
    keep.push(o);
  }
  g.objects = keep;
}

// Which object should be classified next: the closest one to the player that
// has no label for the current rule.
export function nextToClassify(g) {
  let best = null, bd = Infinity;
  for (const o of g.objects) {
    if (labelOf(g, o)) continue;
    const d = Math.hypot(o.x - g.player.x, o.y - g.player.y);
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}

export function waveSummary(g) {
  return [...g.waveStats, { rule: g.rule.text, ...g.stats, score: g.waveScore, partial: true }];
}
