// The System One agent: turn the game observation into text, ask one
// `choice` question, and return a typed decision. Shared by index.html and bench.mjs.

export const MODEL = 'tev1:0.8b';

export const QUESTIONS = {
  action: {
    type: 'choice',
    instructions:
      'You are the dinosaur in a side-scrolling runner. Choose what to do RIGHT NOW. ' +
      'If an obstacle will hit you very soon, avoid it: jump over ground obstacles and low birds, ' +
      'duck under high birds. If the obstacle is still far away, keep running and wait.',
    criteria: {
      run: 'Keep running; nothing will hit me imminently',
      jump: 'Jump now; a ground obstacle or low bird is about to hit me',
      duck: 'Duck now; a high bird is about to hit me',
    },
  },
};

const WHAT = {
  cactusSmall: 'a small cactus on the ground',
  cactusLarge: 'a tall cactus on the ground',
  birdLow: 'a bird flying LOW, near the ground',
  birdHigh: 'a bird flying HIGH, at head height',
};

// Seconds of lead time in which a jump/duck should start. A jump clears an
// obstacle if it starts roughly 0.05–0.3 s before contact.
const IMMINENT_S = 0.28;
const APPROACHING_S = 0.7;

// `semantic`: the harness pre-digests distance into time-to-impact (corrected
// for model latency) plus a coarse label. `raw`: just pixel numbers, to show
// how much the state representation matters.
export function describe(obs, latencyS, style = 'semantic') {
  if (style === 'raw') {
    if (!obs.next) return `speed ${obs.speed.toFixed(0)}px/s. no obstacle on screen. dino on ground.`;
    const n = obs.next;
    return `speed ${obs.speed.toFixed(0)}px/s. next obstacle: ${n.kind} ${n.gap.toFixed(0)}px ahead, ` +
      `width ${n.width}px, height ${n.height}px, ${n.elevation}px above ground. dino on ground.`;
  }

  if (!obs.next) return 'No obstacles ahead. The dinosaur is running on the ground.';
  const n = obs.next;
  const what = WHAT[n.kind];
  const where = obs.ducking ? 'The dinosaur is ducking.' : 'The dinosaur is on the ground.';
  if (n.overlapping) return `Obstacle: ${what}. It is passing the dinosaur RIGHT NOW (IMMINENT). ${where}`;

  // By the time our decision lands, the obstacle will be `latencyS` closer.
  const eff = n.tti - latencyS;
  let timing;
  if (eff <= IMMINENT_S) timing = `IMMINENT: it reaches the dinosaur in ${Math.max(eff, 0).toFixed(2)} seconds`;
  else if (eff <= APPROACHING_S) timing = `still approaching, not close yet: ${eff.toFixed(2)} seconds away, too early to act`;
  else timing = `far away: ${eff.toFixed(2)} seconds away`;
  return `Obstacle: ${what}. Time until it reaches the dinosaur: ${timing}. ${where}`;
}

export class Agent {
  constructor({ endpoint, model, style = 'semantic' }) {
    this.endpoint = endpoint;
    this.model = model || MODEL;
    this.style = style;
    this.latency = 0.15;  // EMA of round-trip seconds, used to lead the target
    this.calls = 0;
  }

  async ask(state) {
    const t0 = performance.now();
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, state, questions: QUESTIONS }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    const body = await res.json();
    const ms = performance.now() - t0;
    return { answer: body.answers.action, ms };
  }

  // The first few calls are slow while the model loads and warms its cache.
  async warmup(n = 3) {
    for (let i = 0; i < n; i++) await this.ask('No obstacles ahead. The dinosaur is running on the ground.');
  }

  async decide(obs) {
    const state = describe(obs, this.latency, this.style);
    const { answer, ms } = await this.ask(state);
    this.calls++;
    this.latency = 0.8 * this.latency + 0.2 * (ms / 1000);
    return { state, ms, choice: answer.choice, confidence: answer.confidence, probabilities: answer.probabilities };
  }
}

// Map a decision onto the game's controls. Duck is held until the next decision.
export function apply(game, choice) {
  game.input.duck = choice === 'duck';
  if (choice === 'jump') game.input.jump = true;
}
