// Dino runner game logic. No DOM here, so the browser page and the headless
// bench (bench.mjs) run exactly the same simulation.
//
// World units are pixels and seconds. y is height above the ground (up = +).

export const WORLD_W = 800;

const GRAVITY = 2400;     // px/s²
const JUMP_V = 750;       // px/s  → ~0.62 s airtime, ~117 px apex
const FAST_FALL = 3;      // gravity multiplier when ducking in mid-air
const START_SPEED = 360;  // px/s
const MAX_SPEED = 800;
const ACCEL = 10;         // px/s per second
const BIRDS_AFTER = 150;  // score before birds can appear
const HITBOX_INSET = 4;

export const DINO_X = 60;
export const DINO_STAND = { w: 40, h: 44 };
export const DINO_DUCK = { w: 56, h: 26 };

// kind → shape. `y` is the obstacle's bottom edge above the ground.
const KINDS = {
  cactusSmall: () => { const n = randInt(1, 3); return { w: 17 * n, h: 35, y: 0, n }; },
  cactusLarge: () => { const n = randInt(1, 2); return { w: 25 * n, h: 50, y: 0, n }; },
  birdLow:     () => ({ w: 42, h: 30, y: 8 }),   // must jump over
  birdHigh:    () => ({ w: 42, h: 30, y: 34 }),  // must duck under
};

function randInt(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
function rand(a, b) { return a + Math.random() * (b - a); }

let nextId = 1;
let nextObstacleId = 1;

export function createGame() {
  return {
    id: nextId++,
    t: 0,
    speed: START_SPEED,
    score: 0,
    over: false,
    cause: null,
    cleared: 0,
    jumps: 0,
    dino: { y: 0, vy: 0, ducking: false },
    input: { jump: false, duck: false },
    obstacles: [],
    nextGap: 300,
  };
}

export function dinoBox(d) {
  const s = d.ducking ? DINO_DUCK : DINO_STAND;
  return { x: DINO_X, y: d.y, w: s.w, h: s.h };
}

function spawn(g) {
  const roll = Math.random();
  let kind;
  if (g.score > BIRDS_AFTER && roll < 0.3) kind = Math.random() < 0.5 ? 'birdLow' : 'birdHigh';
  else kind = Math.random() < 0.6 ? 'cactusSmall' : 'cactusLarge';
  g.obstacles.push({ id: nextObstacleId++, kind, x: WORLD_W, passed: false, ...KINDS[kind]() });
  // Keep at least ~0.85 s between obstacles so a jump always has room to land.
  g.nextGap = g.speed * rand(0.85, 1.6);
}

function overlaps(a, b) {
  const i = HITBOX_INSET;
  return a.x + i < b.x + b.w - i && a.x + a.w - i > b.x + i &&
         a.y + i < b.y + b.h - i && a.y + a.h - i > b.y + i;
}

export function step(g, dt) {
  if (g.over) return;
  g.t += dt;
  g.speed = Math.min(MAX_SPEED, g.speed + ACCEL * dt);
  g.score += g.speed * dt * 0.025;

  const d = g.dino;
  const onGround = d.y === 0 && d.vy === 0;
  if (g.input.jump && onGround) { d.vy = JUMP_V; g.jumps++; }
  g.input.jump = false; // a jump is a one-shot press, not buffered
  if (d.y > 0 || d.vy > 0) {
    d.vy -= GRAVITY * (g.input.duck ? FAST_FALL : 1) * dt;
    d.y += d.vy * dt;
    if (d.y <= 0) { d.y = 0; d.vy = 0; }
  }
  d.ducking = g.input.duck && d.y === 0;

  for (const o of g.obstacles) {
    o.x -= g.speed * dt;
    if (!o.passed && o.x + o.w < DINO_X) { o.passed = true; g.cleared++; }
  }
  g.obstacles = g.obstacles.filter(o => o.x + o.w > -10);
  const last = g.obstacles[g.obstacles.length - 1];
  if (!last || last.x + last.w < WORLD_W - g.nextGap) spawn(g);

  const box = dinoBox(d);
  for (const o of g.obstacles) {
    if (overlaps(box, o)) { g.over = true; g.cause = o.kind; break; }
  }
}

// What the agent is allowed to know: the next obstacle that hasn't fully passed.
export function observe(g) {
  const d = g.dino;
  const next = g.obstacles.find(o => o.x + o.w > DINO_X);
  const base = {
    speed: g.speed,
    airborne: d.y > 0 || d.vy > 0,
    ducking: d.ducking,
    next: null,
    upcoming: g.obstacles.filter(o => o.x + o.w > DINO_X).map(o => ({ id: o.id, kind: o.kind })),
  };
  if (!next) return base;
  const gap = next.x - (DINO_X + DINO_STAND.w);
  return {
    ...base,
    next: {
      id: next.id,
      kind: next.kind,
      gap,                    // px from dino's nose to obstacle's front edge
      width: next.w,
      height: next.h,
      elevation: next.y,
      tti: gap / g.speed,     // seconds until contact if nothing changes
      overlapping: gap < 0,
    },
  };
}
