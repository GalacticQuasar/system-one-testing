// The System One agent for both modes. Each mode turns facts into a `state`
// string plus questions, and turns the answers back into a decision.
// Shared by index.html, bench.mjs and probe.mjs.

import { facts } from './city.js';

export const MODEL = 'tev1:0.8b';

export class Agent {
  constructor({ endpoint, model }) {
    this.endpoint = endpoint;
    this.model = model || MODEL;
    this.calls = 0;
    this.latency = 0.3;  // EMA of round-trip seconds
  }

  async ask(state, questions) {
    const t0 = performance.now();
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, state, questions }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    const answers = (await res.json()).answers;
    const ms = performance.now() - t0;
    this.calls++;
    this.latency = 0.8 * this.latency + 0.2 * ms / 1000;
    return { answers, ms };
  }

  // The first few calls are slow while the model loads and warms up.
  async warmup(n = 3) {
    for (let i = 0; i < n; i++) await this.ask('The road goes straight ahead.', TRACK_QUESTIONS);
  }
}

// ---------- city: driver's judgment ----------

// Two facts about the object, asked together; plain code combines them.
// Question keys are part of the prompt and matter: `living`/`solid` score 18/24
// in probe.mjs, `is_living`/`hard_or_soft` 20/24.
// (Asking for stop/around/over directly does worse: the model leans on "drive over".)
const HAZARD_QUESTIONS = {
  is_living: { type: 'noul', instructions: 'Is this a living person or animal?' },
  hard_or_soft: {
    type: 'choice',
    instructions: 'You are driving. Is this object hard and heavy, or soft and light?',
    criteria: { hard: 'Hard, heavy, or a hole in the road', soft: 'Soft, light, flat, or just a marking' },
  },
};

const ROUTE_TEXT = { left: 'turn left', straight: 'go straight', right: 'turn right' };

const SIGNAL_QUESTIONS = {
  may_enter: {
    type: 'choice',
    instructions: 'You are about to drive into an intersection. Following the traffic control, may you drive through now?',
    criteria: { go: 'Go: you may drive through', stop: 'Stop: you must stop and wait' },
  },
};
const CROSSING_QUESTIONS = {
  someone_crossing: { type: 'noul', instructions: 'Is a person, animal or vehicle crossing in front of you right now?' },
};

// The signpost goes in the options, place first, so the model matches need →
// place. ("Turn right, toward the Zoo" makes it favour left and straight.)
function routeQuestions(sign) {
  return {
    route: {
      type: 'choice',
      instructions: 'You are a taxi driver at an intersection. Which way leads to where your passenger needs to go?',
      criteria: Object.fromEntries(Object.entries(sign).map(([d, places]) => [d, `The ${places.join(' and the ')} (${ROUTE_TEXT[d]})`])),
    },
  };
}

// The calls an event needs, as [{ state, questions }]. An intersection is
// three calls, sent together, one per fact: the traffic control, the
// crosswalk, the passenger. With all the facts in one state the model mixes
// them up (a dog on the sidewalk makes it read a green light as "stop").
// Keys matter here too: `crossing` alone answers 0.54 "yes" for an empty
// crosswalk, `someone_crossing` 0.21.
export function cityQuery(g, ev) {
  const f = facts(g, ev);
  if (ev.type === 'hazard') return [{ state: `In your lane ahead: ${f.item}.`, questions: HAZARD_QUESTIONS }];
  return [
    { state: f.signal, questions: SIGNAL_QUESTIONS },
    { state: f.crosswalk, questions: CROSSING_QUESTIONS },
    { state: `Passenger: "${f.quote}"`, questions: routeQuestions(f.sign) },
  ];
}

// `a`: the answers of all of an event's calls, merged.
export function cityDecision(ev, a) {
  if (ev.type === 'hazard') {
    const pLiving = a.is_living.noul, pHard = a.hard_or_soft.probabilities.hard;
    const p = { stop: pLiving, around: (1 - pLiving) * pHard, over: (1 - pLiving) * (1 - pHard) };
    const action = pLiving > 0.5 ? 'stop' : pHard > 0.5 ? 'around' : 'over';
    return { action, p };
  }
  const pGo = a.may_enter.probabilities.go, pCross = a.someone_crossing.noul;
  return { go: pGo > 0.5 && pCross < 0.5, turn: a.route.choice, pGo, pCross, pTurn: a.route.probabilities };
}

// ---------- track: direct steering ----------

export const TRACK_QUESTIONS = {
  steer: {
    type: 'score',
    instructions: 'You are steering a car. Steer toward where the road goes.',
    criteria: ['Hard left', 'Slight left', 'Straight', 'Slight right', 'Hard right'],
  },
};

const side = deg => deg < 0 ? `${-deg}° left` : deg > 0 ? `${deg}° right` : 'straight ahead';

// `raw`: what the car's sensors measure, nothing interpreted.
// `semantic`: the harness works out where the road goes relative to the car's
// nose and puts it in words, which is most of the steering problem solved.
export function trackState(obs, style) {
  if (style === 'raw') {
    return 'Distance from the car to the edge of the road, in pixels: ' +
      obs.rays.map(r => `${side(r.deg)} ${r.dist}`).join(', ') + '.';
  }
  const b = obs.bearing, dir = b < 0 ? 'left' : 'right';
  if (Math.abs(b) < 5) return 'The road goes straight ahead.';
  if (Math.abs(b) < 18) return `The road veers slightly ${dir}.`;
  return `The road turns sharply ${dir}.`;
}

// score 0..4 → steering −1..1
export const trackSteer = a => (a.steer.score - 2) / 2;
