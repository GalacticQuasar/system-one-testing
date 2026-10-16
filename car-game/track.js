// Track mode: a closed loop road, and the decider steers directly. No DOM, so
// the page and the headless bench run the same simulation.
//
// Every decision is one steering value in [-1, 1] (− left, + right), held
// until the next decision lands. Speed is fixed. Leaving the road counts as a
// crash: the car is put back on the centre line and loses a moment.

export const W = 800, H = 500;
export const HALF_W = 34;       // half the road width
export const CAR_R = 8;         // how far the car's corners reach from its centre, sideways
const STEP = 4;                 // px between centre-line samples
const MAX_TURN = 2.4;           // rad/s at full lock
const STEER_RATE = 6;           // how fast the wheel follows the command, per second
const CRASH_FREEZE = 0.7;       // s
export const SPEEDS = { slow: 60, medium: 85, fast: 120 };

// Sensor rays for the raw description, degrees from the car's heading.
export const RAYS = [-60, -30, 0, 30, 60];
const RAY_MAX = 300;

const CTRL = [
  [110, 120], [260, 62], [420, 110], [565, 66], [712, 120], [735, 255], [622, 318],
  [705, 430], [520, 452], [405, 360], [282, 442], [112, 412], [68, 262],
];

function buildTrack(ctrl) {
  const n = ctrl.length, dense = [];
  for (let i = 0; i < n; i++) {
    const p0 = ctrl[(i - 1 + n) % n], p1 = ctrl[i], p2 = ctrl[(i + 1) % n], p3 = ctrl[(i + 2) % n];
    for (let k = 0; k < 50; k++) {
      const t = k / 50, t2 = t * t, t3 = t2 * t;
      const f = j => 0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 +
                            (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3);
      dense.push([f(0), f(1)]);
    }
  }
  // Resample at an even spacing so index differences are distances.
  const pts = [dense[0]];
  let carry = 0;
  for (let i = 0; i < dense.length; i++) {
    const a = dense[i], b = dense[(i + 1) % dense.length];
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let s = STEP - carry;
    while (s <= seg) {
      pts.push([a[0] + (b[0] - a[0]) * s / seg, a[1] + (b[1] - a[1]) * s / seg]);
      s += STEP;
    }
    carry = seg - (s - STEP);
  }
  if (Math.hypot(pts[pts.length - 1][0] - pts[0][0], pts[pts.length - 1][1] - pts[0][1]) < STEP / 2) pts.pop();
  const N = pts.length;
  const ang = pts.map((_, i) => {
    const a = pts[(i - 1 + N) % N], b = pts[(i + 1) % N];
    return Math.atan2(b[1] - a[1], b[0] - a[0]);
  });
  return { pts, ang, N, length: N * STEP };
}

export const TRACK = buildTrack(CTRL);

export const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

// Closest centre-line sample to (x, y), searching near `hint` when given.
// `lat` is the signed distance from the centre line (+ = right of travel).
export function nearest(x, y, hint = null) {
  const { pts, ang, N } = TRACK;
  let best = 0, bd = Infinity;
  const lo = hint == null ? 0 : hint - 80, hi = hint == null ? N : hint + 80;
  for (let k = lo; k < hi; k++) {
    const i = ((k % N) + N) % N;
    const d = (pts[i][0] - x) ** 2 + (pts[i][1] - y) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  const a = ang[best], dx = x - pts[best][0], dy = y - pts[best][1];
  return { i: best, lat: -Math.sin(a) * dx + Math.cos(a) * dy };
}

let nextGameId = 1;

export function createGame(speed = SPEEDS.medium) {
  const g = {
    id: nextGameId++,
    t: 0,
    speed,
    car: null,
    steer: 0,          // actual wheel position
    command: 0,        // what the driver last asked for
    progress: 0,       // laps, fractional
    crashes: 0,
    frozen: 0,
    lapStart: 0,
    lapCrashes: 0,
    laps: [],          // { time, crashes }
  };
  resetCar(g, 0);
  return g;
}

function resetCar(g, i) {
  const { pts, ang } = TRACK;
  g.car = { x: pts[i][0], y: pts[i][1], a: ang[i], i };
  g.steer = 0;
  g.command = 0;
}

export function step(g, dt) {
  g.t += dt;
  if (g.frozen > 0) { g.frozen -= dt; return; }
  const c = g.car;
  g.steer += Math.max(-STEER_RATE * dt, Math.min(STEER_RATE * dt, g.command - g.steer));
  c.a = wrap(c.a + g.steer * MAX_TURN * dt);
  c.x += Math.cos(c.a) * g.speed * dt;
  c.y += Math.sin(c.a) * g.speed * dt;

  const near = nearest(c.x, c.y, c.i);
  let di = near.i - c.i;
  if (di > TRACK.N / 2) di -= TRACK.N;
  if (di < -TRACK.N / 2) di += TRACK.N;
  const before = Math.floor(g.progress);
  g.progress += di / TRACK.N;
  c.i = near.i;
  if (Math.floor(g.progress) > before && g.progress > 0.5) {
    g.laps.push({ time: g.t - g.lapStart, crashes: g.lapCrashes });
    g.lapStart = g.t;
    g.lapCrashes = 0;
  }

  if (Math.abs(near.lat) > HALF_W - CAR_R) {
    g.crashes++;
    g.lapCrashes++;
    g.lastCrash = { x: c.x, y: c.y, t: g.t };
    resetCar(g, (near.i + 3) % TRACK.N);
    g.frozen = CRASH_FREEZE;
  }
}

// Distance from the car to the road edge along a ray, angle in degrees from heading.
function castRay(c, deg) {
  const a = c.a + deg * Math.PI / 180;
  let hint = c.i;
  for (let d = 0; d <= RAY_MAX; d += 3) {
    const n = nearest(c.x + Math.cos(a) * d, c.y + Math.sin(a) * d, hint);
    hint = n.i;
    if (Math.abs(n.lat) > HALF_W) return d;
  }
  return RAY_MAX;
}

// What a driver can know. `lookahead` is in seconds of travel.
export function observe(g, lookahead = 0.9) {
  const c = g.car, { pts } = TRACK;
  const near = nearest(c.x, c.y, c.i);
  const ahead = Math.round(g.speed * lookahead / STEP) + 6;
  const p = pts[(near.i + ahead) % TRACK.N];
  return {
    rays: RAYS.map(deg => ({ deg, dist: castRay(c, deg) })),
    lat: near.lat,
    // Where the road centre `lookahead` s ahead is, relative to the car's nose (+ = right).
    bearing: wrap(Math.atan2(p[1] - c.y, p[0] - c.x) - c.a) * 180 / Math.PI,
    target: p,
    speed: g.speed,
  };
}

// Pure-pursuit steering from the same observation: the ceiling for this road.
export function oracleSteer(obs) {
  return Math.max(-1, Math.min(1, obs.bearing / 22));
}
