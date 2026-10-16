// City mode: a car drives an endless grid of streets. No DOM, so the page
// and the headless bench run the same simulation.
//
// Split of work:
//   - the decider (model / oracle / random) makes the calls a driver makes by
//     understanding the scene: is the thing in my lane a creature, debris or
//     litter? may I enter this intersection? which way is the place my
//     passenger needs?
//   - plain code (below) keeps the car in its lane, sets the speed, brakes
//     for anything not yet decided, and drives the turns.
// The decider only ever sees text facts. The `kind` / `go` / `crossing`
// fields here are ground truth for scoring and are never shown to it.

export const W = 800, H = 500;
export const BLOCK = 320;      // px between intersections
export const LANE = 13;        // lane centre, measured from the road's centre line
export const ROAD_HALF = 30;
export const JR = 42;          // stop line distance from the intersection centre

const CRUISE = 110;            // px/s
const ACCEL = 140;             // px/s²
const DECEL = 320;
const SWERVE_V = 80;           // px/s sideways
const ASK_JUNCTION = 240;      // start asking about the intersection this far out
const PATIENCE = 4;            // s stopped with nothing changing before code gives up and goes
const HAZARD_ODDS = 0.55;

export const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];  // E S W N (screen y points down)
const TURNS = { left: 3, straight: 0, right: 1 };          // added to dir, mod 4

// Things that can be in the lane. kind → what a careful driver does:
//   living → stop and let it move, solid → steer around, harmless → drive on.
export const HAZARDS = [
  { text: 'a child chasing a ball', emoji: '🧒', kind: 'living' },
  { text: 'a dog', emoji: '🐕', kind: 'living' },
  { text: 'a deer', emoji: '🦌', kind: 'living' },
  { text: 'an elderly man crossing slowly', emoji: '👴', kind: 'living' },
  { text: 'a mother duck with ducklings', emoji: '🦆', kind: 'living' },
  { text: 'a cat', emoji: '🐈', kind: 'living' },
  { text: 'a jogger', emoji: '🏃', kind: 'living' },
  { text: 'a cyclist who fell off their bike', emoji: '🚴', kind: 'living' },
  { text: 'a fallen tree branch', emoji: '🪵', kind: 'solid' },
  { text: 'a large rock', emoji: '🪨', kind: 'solid' },
  { text: 'a stack of bricks', emoji: '🧱', kind: 'solid' },
  { text: 'a deep pothole', emoji: '🕳️', kind: 'solid' },
  { text: 'a shopping cart', emoji: '🛒', kind: 'solid' },
  { text: 'a toolbox', emoji: '🧰', kind: 'solid' },
  { text: 'a loose tire', emoji: '🛞', kind: 'solid' },
  { text: 'a mattress', emoji: '🛏️', kind: 'solid' },
  { text: 'a plastic bag', emoji: '🛍️', kind: 'harmless' },
  { text: 'a shallow puddle', emoji: '💧', kind: 'harmless' },
  { text: 'some fallen leaves', emoji: '🍂', kind: 'harmless' },
  { text: 'a newspaper', emoji: '📰', kind: 'harmless' },
  { text: 'a paper cup', emoji: '🥤', kind: 'harmless' },
  { text: 'a feather', emoji: '🪶', kind: 'harmless' },
  { text: 'a candy wrapper', emoji: '🍬', kind: 'harmless' },
  { text: 'a manhole cover', emoji: '⚫', kind: 'harmless' },
];
export const HAZARD_ACTION = { living: 'stop', solid: 'around', harmless: 'over' };

// Points for each (truth, action). Hitting a living thing is the big one.
const HAZARD_POINTS = {
  living:   { stop: 10, around: -20, over: -100 },
  solid:    { stop: -5, around: 10, over: -30 },
  harmless: { stop: -5, around: -3, over: 10 },
};

// Intersection controls. `next`/`after`: what it changes to while the car waits.
export const SIGNALS = {
  green:       { text: 'Traffic light: green.', go: true },
  red:         { text: 'Traffic light: red.', go: false, next: 'green', after: [2, 4] },
  yellow:      { text: 'Traffic light: yellow.', go: false, next: 'red', after: [0.8, 1.2] },
  none:        { text: 'There is no traffic light or stop sign at this intersection.', go: true },
  officerGo:   { text: 'A police officer is waving you through.', go: true },
  officerStop: { text: 'A police officer is holding up a hand to stop you.', go: false, next: 'officerGo', after: [2, 4] },
};
const SIGNAL_ODDS = [['green', 4], ['red', 3], ['yellow', 1], ['none', 1.5], ['officerGo', 0.7], ['officerStop', 0.7]];

// Who is at the crosswalk. Bystanders are on the sidewalk, not in the way.
export const CROSSERS = [
  { text: 'A woman is walking across the crosswalk in front of you.', emoji: '🚶‍♀️', crossing: true },
  { text: 'A man pushing a stroller is crossing in front of you.', emoji: '🚶', crossing: true },
  { text: 'A dog is running across the crosswalk.', emoji: '🐕', crossing: true },
  { text: 'A group of schoolchildren is crossing the street in front of you.', emoji: '🧒', crossing: true },
  { text: 'A cyclist is crossing in front of you.', emoji: '🚴', crossing: true },
  { text: 'A man is standing on the sidewalk, waiting.', emoji: '🧍', crossing: false },
  { text: 'A dog is sitting on the sidewalk.', emoji: '🐕', crossing: false },
];
export const CROSSWALK_EMPTY = 'The crosswalk ahead is empty.';

// Destinations, and what a passenger going there might say.
export const PLACES = {
  'Hospital': ['My passenger is having chest pains.', 'I cut my hand really badly.'],
  'Airport': ['I have a flight to catch in two hours.', "We're picking up grandma, her plane lands at noon."],
  'Train Station': ['I need to catch the 5:15 train.'],
  'Supermarket': ['We need milk and eggs for dinner.'],
  'School': ["I'm dropping the kids off for class."],
  'Beach': ["Let's go swimming in the ocean."],
  'Stadium': ['We have tickets to the football game.'],
  'Gas Station': ['The fuel light just came on.'],
  'Library': ['I need to return some overdue books.'],
  'Zoo': ['The kids want to see the elephants.'],
  'Post Office': ['I need to mail a package.'],
  'Vet Clinic': ['My dog is sick.'],
};
const TRIP_TURNS = 3;  // correct turns needed to arrive

const rand = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.floor(Math.random() * a.length)];
function weighted(pairs) {
  let r = Math.random() * pairs.reduce((s, p) => s + p[1], 0);
  for (const [k, w] of pairs) if ((r -= w) < 0) return k;
  return pairs[0][0];
}
function shuffled(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

let nextGameId = 1;
let nextEventId = 1;

const newTally = () => ({ n: 0, ok: 0 });

export function createGame() {
  const g = {
    id: nextGameId++,
    t: 0,
    score: 0,
    car: { node: [1, 0], dir: 0, dist: BLOCK - JR, v: CRUISE / 2, swerve: 0, junction: null, x: 0, y: 0, a: 0 },
    events: [],             // what's ahead on this block: optional hazard, then the intersection
    trip: null,
    trips: 0,
    blocks: 0,
    tally: { hazard: newTally(), junction: newTally(), route: newTally() },
    outcomes: [],           // scored moments, for the UI log
    flashes: [],            // short-lived markers drawn on the map
  };
  newTrip(g);
  enterBlock(g);
  place(g);
  return g;
}

function newTrip(g) {
  const dest = pick(Object.keys(PLACES));
  g.trip = { dest, quote: pick(PLACES[dest]), left: TRIP_TURNS };
}

function outcome(g, kind, ok, pts, text, at) {
  g.score += pts;
  g.outcomes.push({ t: g.t, kind, ok, pts, text });
  if (at) g.flashes.push({ x: at[0], y: at[1], ok, t: g.t });
}

function enterBlock(g) {
  const c = g.car;
  g.blocks++;
  g.events = [];
  if (g.blocks > 1 && Math.random() < HAZARD_ODDS) {
    g.events.push({
      type: 'hazard', id: nextEventId++, item: pick(HAZARDS), at: rand(125, 185),
      state: 'present', leaveIn: null, out: 0, decision: null, pending: false, waitT: 0, hit: false,
    });
  }
  // Signpost: the destination is down exactly one of the three ways.
  const others = shuffled(Object.keys(PLACES).filter(p => p !== g.trip.dest));
  const truthTurn = pick(Object.keys(TURNS));
  const sign = {};
  for (const d of Object.keys(TURNS)) sign[d] = [d === truthTurn ? g.trip.dest : others.pop()];
  if (Math.random() < 0.5) sign[pick(Object.keys(TURNS))].push(others.pop());
  const signal = weighted(SIGNAL_ODDS);
  const roll = Math.random();
  const crosser = roll < 0.3 ? pick(CROSSERS.filter(x => x.crossing)) : roll < 0.42 ? pick(CROSSERS.filter(x => !x.crossing)) : null;
  g.events.push({
    type: 'junction', id: nextEventId++, node: [...c.node],
    signal, signalT: timerFor(signal),
    crosser, crossP: rand(0.25, 0.45), crossT: rand(2, 3.2),
    sign, truthTurn, trip: g.trip,
    version: 0, decision: null, pending: false, stopped: false, waitT: 0,
  });
}

function timerFor(signal) {
  const s = SIGNALS[signal];
  return s.after ? rand(...s.after) : Infinity;
}

// What the junction should get right now: may the car enter?
export function junctionTruth(ev) {
  return SIGNALS[ev.signal].go && !(ev.crosser && ev.crosser.crossing);
}

// ---------- the decider's interface ----------

// Event that needs an answer next, or null. Hazards come first (they're closer).
export function nextToDecide(g) {
  if (g.car.junction) return null;
  for (const ev of g.events) {
    if (ev.pending) return null;
    if (ev.type === 'hazard') {
      if (ev.state === 'present' && !ev.decision) return ev;
    } else if (g.car.dist <= ASK_JUNCTION) {
      // Ask once, then again whenever the facts change while we wait.
      if (!ev.decision || (!ev.decision.go && ev.decision.version !== ev.version)) return ev;
    }
  }
  return null;
}

// hazard decision: { action: 'stop'|'around'|'over', ... }
// junction decision: { go: bool, turn: 'left'|'straight'|'right', ... }
export function setDecision(g, ev, d) {
  if (!g.events.includes(ev)) return;
  ev.decision = d;
  if (ev.type === 'hazard') {
    const truth = HAZARD_ACTION[ev.item.kind];
    const pts = HAZARD_POINTS[ev.item.kind][d.action];
    g.tally.hazard.n++;
    if (d.action === truth) g.tally.hazard.ok++;
    const verb = { stop: 'stopped for', around: 'steered around', over: 'drove over' }[d.action];
    outcome(g, 'hazard', d.action === truth, pts, `${verb} ${ev.item.text}`);
  } else {
    d.version = ev.version;
    const truth = junctionTruth(ev);
    g.tally.junction.n++;
    if (d.go === truth) g.tally.junction.ok++;
    ev.waitT = 0;
    if (d.go === truth) outcome(g, 'junction', true, 2, d.go ? 'entered intersection: clear' : `stopped: ${stopReason(ev)}`);
    // Going when it should stop is scored when the car actually enters.
    else if (!d.go) outcome(g, 'junction', false, -5, `stopped for no reason (${SIGNALS[ev.signal].text.replace(/\.$/, '').toLowerCase()})`);
  }
}

function stopReason(ev) {
  if (ev.crosser && ev.crosser.crossing) return 'someone is crossing';
  return SIGNALS[ev.signal].text.replace(/\.$/, '').toLowerCase();
}

// Facts the decider is allowed to see.
export function facts(g, ev) {
  if (ev.type === 'hazard') return { item: ev.item.text };
  return {
    signal: SIGNALS[ev.signal].text,
    crosswalk: ev.crosser ? ev.crosser.text : CROSSWALK_EMPTY,
    quote: ev.trip.quote,
    sign: ev.sign,
  };
}

// Instant, ground-truth answers: the ceiling for the driving code.
export function oracleDecision(ev) {
  if (ev.type === 'hazard') return { action: HAZARD_ACTION[ev.item.kind] };
  return { go: junctionTruth(ev), turn: ev.truthTurn };
}

export function randomDecision(ev) {
  if (ev.type === 'hazard') return { action: pick(['stop', 'around', 'over']) };
  return { go: Math.random() < 0.5, turn: pick(Object.keys(TURNS)) };
}

// ---------- simulation ----------

const hazardAhead = (g, ev) => ev.state !== 'gone' && !ev.passed;

// Distance-to-intersection where the car must be stopped, or null if it may pass.
function stopPoint(g, ev) {
  if (ev.type === 'hazard') {
    if (!hazardAhead(g, ev)) return null;
    if (ev.decision && ev.decision.action !== 'stop') return null;
    return ev.at + 30;
  }
  return ev.decision && ev.decision.go ? null : JR + 2;
}

export function step(g, dt) {
  g.t += dt;
  const c = g.car;
  g.flashes = g.flashes.filter(f => g.t - f.t < 1.2);
  if (c.junction) { driveJunction(g, dt); place(g); return; }

  let vmax = CRUISE;
  for (const ev of g.events) {
    const sp = stopPoint(g, ev);
    if (sp != null) vmax = Math.min(vmax, Math.sqrt(2 * DECEL * Math.max(0, c.dist - sp)));
  }
  c.v = Math.min(c.v + ACCEL * dt, vmax);
  c.dist -= c.v * dt;
  const stopped = c.v < 1;

  for (const ev of g.events) {
    if (ev.type === 'hazard') updateHazard(g, ev, dt, stopped);
    else updateJunction(g, ev, dt, stopped);
  }

  // Swerve into the oncoming lane around a hazard we decided to avoid.
  const hz = g.events.find(e => e.type === 'hazard');
  let want = 0;
  if (hz && hz.decision && hz.decision.action === 'around' && hz.state !== 'gone' &&
      c.dist < hz.at + 95 && c.dist > hz.at - 28) want = 2 * LANE;
  c.swerve += Math.max(-SWERVE_V * dt, Math.min(SWERVE_V * dt, want - c.swerve));

  if (c.dist <= JR) enterJunction(g);
  place(g);
}

function updateHazard(g, ev, dt, stopped) {
  const c = g.car;
  const gap = c.dist - ev.at;
  // Creatures wander off a few seconds after the car gets close.
  if (ev.item.kind === 'living' && ev.state === 'present' && ev.leaveIn == null && gap < 120) ev.leaveIn = rand(2.2, 3.5);
  if (ev.leaveIn != null && ev.state !== 'gone') {
    ev.leaveIn -= dt;
    if (ev.leaveIn <= 0) { ev.state = 'leaving'; ev.out += 40 * dt; if (ev.out > 30) ev.state = 'gone'; }
  }
  // Stopped for an object that isn't going anywhere: code gives up and goes around.
  if (ev.decision && ev.decision.action === 'stop' && ev.item.kind !== 'living' && stopped && gap < 40) {
    ev.waitT += dt;
    if (ev.waitT > 2) ev.decision = { ...ev.decision, action: 'around', fallback: true };
  }
  // Contact: car's front reaches the object while it is still in our lane.
  if (!ev.passed && gap < 12) {
    ev.passed = true;
    const inLane = ev.state === 'present' && c.swerve < LANE;
    if (inLane && ev.item.kind !== 'harmless') {
      ev.hit = true;
      g.flashes.push({ x: c.x, y: c.y, ok: false, t: g.t });
    }
  }
}

function updateJunction(g, ev, dt, stopped) {
  const c = g.car;
  if (!(stopped && c.dist - JR < 10)) return;
  ev.stopped = true;
  // The world moves on while we wait at the line.
  ev.signalT -= dt;
  if (ev.signalT <= 0) {
    ev.signal = SIGNALS[ev.signal].next;
    ev.signalT = timerFor(ev.signal);
    ev.version++;
  }
  if (ev.crosser && ev.crosser.crossing) {
    ev.crossP += dt / ev.crossT;
    if (ev.crossP >= 1) { ev.crosser = null; ev.version++; }
  }
  // Told to stop but nothing is changing: the stop was a mistake. Code moves on.
  if (ev.decision && !ev.decision.go && ev.decision.version === ev.version) {
    ev.waitT += dt;
    if (ev.waitT > PATIENCE && junctionTruth(ev)) ev.decision = { ...ev.decision, go: true, fallback: true };
  }
}

function enterJunction(g) {
  const c = g.car;
  const ev = g.events.find(e => e.type === 'junction');
  const node = [c.node[0] * BLOCK, c.node[1] * BLOCK];
  const at = [c.x, c.y];
  if (!SIGNALS[ev.signal].go) outcome(g, 'junction', false, -30, `ran it: ${SIGNALS[ev.signal].text.replace(/\.$/, '').toLowerCase()}`, at);
  if (ev.crosser && ev.crosser.crossing) outcome(g, 'junction', false, -100, `hit: ${ev.crosser.text.split(' ').slice(0, 3).join(' ').toLowerCase()}…`, at);

  const turn = ev.decision.turn;
  const ok = turn === ev.truthTurn;
  g.tally.route.n++;
  if (ok) {
    g.tally.route.ok++;
    g.trip.left--;
    outcome(g, 'route', true, 10, `${turn} toward the ${g.trip.dest}`);
    if (g.trip.left <= 0) {
      g.trips++;
      outcome(g, 'route', true, 30, `arrived at the ${g.trip.dest}`, at);
      newTrip(g);
    }
  } else {
    outcome(g, 'route', false, -10, `wrong turn: ${turn} (sign said ${ev.truthTurn} for the ${g.trip.dest})`);
  }

  const d0 = DIRS[c.dir], newDir = (c.dir + TURNS[turn]) % 4, d1 = DIRS[newDir];
  const r0 = DIRS[(c.dir + 1) % 4], r1 = DIRS[(newDir + 1) % 4];
  const P0 = [node[0] - d0[0] * JR + r0[0] * LANE, node[1] - d0[1] * JR + r0[1] * LANE];
  const P2 = [node[0] + d1[0] * JR + r1[0] * LANE, node[1] + d1[1] * JR + r1[1] * LANE];
  // Control point: where the two lane lines cross (midpoint when going straight).
  const P1 = turn === 'straight'
    ? [(P0[0] + P2[0]) / 2, (P0[1] + P2[1]) / 2]
    : [node[0] + r0[0] * LANE + r1[0] * LANE, node[1] + r0[1] * LANE + r1[1] * LANE];
  let len = 0;
  for (let i = 0, p = P0; i < 16; i++) { const q = bezier(P0, P1, P2, (i + 1) / 16); len += Math.hypot(q[0] - p[0], q[1] - p[1]); p = q; }
  c.junction = { P0, P1, P2, len, s: 0, newDir };
  c.swerve = 0;
  c.v = Math.max(c.v, 20);
}

function driveJunction(g, dt) {
  const c = g.car, j = c.junction;
  c.v = Math.min(CRUISE, c.v + ACCEL * dt);
  j.s += c.v * dt;
  if (j.s >= j.len) {
    c.dir = j.newDir;
    c.node = [c.node[0] + DIRS[c.dir][0], c.node[1] + DIRS[c.dir][1]];
    c.dist = BLOCK - JR - (j.s - j.len);
    c.junction = null;
    enterBlock(g);
  }
}

function bezier(P0, P1, P2, t) {
  const u = 1 - t;
  return [u * u * P0[0] + 2 * u * t * P1[0] + t * t * P2[0], u * u * P0[1] + 2 * u * t * P1[1] + t * t * P2[1]];
}

// World position + heading of the car.
function place(g) {
  const c = g.car;
  if (c.junction) {
    const j = c.junction, t = Math.min(1, j.s / j.len);
    [c.x, c.y] = bezier(j.P0, j.P1, j.P2, t);
    const u = 1 - t;
    const dx = 2 * u * (j.P1[0] - j.P0[0]) + 2 * t * (j.P2[0] - j.P1[0]);
    const dy = 2 * u * (j.P1[1] - j.P0[1]) + 2 * t * (j.P2[1] - j.P1[1]);
    c.a = Math.atan2(dy, dx);
    return;
  }
  const [x, y] = laneToWorld(c.node, c.dir, c.dist, LANE - c.swerve);
  c.x = x; c.y = y;
  c.a = Math.atan2(DIRS[c.dir][1], DIRS[c.dir][0]) - swerveYaw(g);
}

// Little yaw while changing lanes, for looks.
function swerveYaw(g) {
  const c = g.car, hz = g.events.find(e => e.type === 'hazard');
  if (!hz || !hz.decision || hz.decision.action !== 'around') return 0;
  const want = hz.state !== 'gone' && c.dist < hz.at + 95 && c.dist > hz.at - 28 ? 2 * LANE : 0;
  if (Math.abs(want - c.swerve) < 0.5) return 0;
  return Math.sign(want - c.swerve) * 0.35;
}

// A point on the street leading into `node` along `dir`, `dist` before the
// intersection centre and `lat` to the right of the centre line.
export function laneToWorld(node, dir, dist, lat) {
  const d = DIRS[dir], r = DIRS[(dir + 1) % 4];
  return [node[0] * BLOCK - d[0] * dist + r[0] * lat, node[1] * BLOCK - d[1] * dist + r[1] * lat];
}

export const accuracy = t => t.n ? t.ok / t.n : null;
