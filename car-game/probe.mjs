// Per-question accuracy of the city calls, with no game running: every
// hazard, every signal × crosswalk combination, and random signposts.
//
// Usage: OLLAMA_HOST=http://localhost:11435 node probe.mjs [signposts=24]
import { HAZARDS, HAZARD_ACTION, SIGNALS, CROSSERS, CROSSWALK_EMPTY, PLACES } from './city.js';
import { Agent, cityQuery, cityDecision } from './agent.js';

const HOST = (process.env.OLLAMA_HOST || 'http://localhost:11434').replace(/\/$/, '');
const agent = new Agent({ endpoint: `${HOST}/v1/systemone`, model: process.env.MODEL });
const nSigns = Number(process.argv[2] || 24);
const pick = a => a[Math.floor(Math.random() * a.length)];

// Run every call an event needs, the same way the page does.
async function decide(ev) {
  const calls = cityQuery(null, ev);
  const answers = {};
  for (const { state, questions } of calls) Object.assign(answers, (await agent.ask(state, questions)).answers);
  return cityDecision(ev, answers);
}

const trip = { dest: 'Hospital', quote: PLACES.Hospital[0] };
const sign = { left: ['Zoo'], straight: ['Hospital'], right: ['Beach'] };
const junction = (signal, crosser) => ({ type: 'junction', signal, crosser, trip, sign, truthTurn: 'straight' });

let ok = 0;
const wrong = [];
for (const item of HAZARDS) {
  const d = await decide({ type: 'hazard', item });
  const truth = HAZARD_ACTION[item.kind];
  if (d.action === truth) ok++; else wrong.push(`${item.text}: ${d.action} (should ${truth})`);
}
console.log(`hazards ${ok}/${HAZARDS.length}${wrong.length ? '\n  ' + wrong.join('\n  ') : ''}`);

ok = 0; wrong.length = 0;
let n = 0;
for (const signal of Object.keys(SIGNALS)) for (const crosser of [null, ...CROSSERS]) {
  const d = await decide(junction(signal, crosser));
  const truth = SIGNALS[signal].go && !(crosser && crosser.crossing);
  n++;
  if (d.go === truth) ok++;
  else wrong.push(`${SIGNALS[signal].text} ${crosser ? crosser.text : CROSSWALK_EMPTY} → ${d.go ? 'go' : 'stop'} (P(go) ${d.pGo.toFixed(2)}, P(crossing) ${d.pCross.toFixed(2)})`);
}
console.log(`go/stop ${ok}/${n}${wrong.length ? '\n  ' + wrong.join('\n  ') : ''}`);

ok = 0;
const byDir = { left: [0, 0], straight: [0, 0], right: [0, 0] };
for (let i = 0; i < nSigns; i++) {
  const dest = pick(Object.keys(PLACES));
  const others = Object.keys(PLACES).filter(p => p !== dest).sort(() => Math.random() - 0.5);
  const truthTurn = pick(['left', 'straight', 'right']);
  const s = {};
  for (const d of ['left', 'straight', 'right']) s[d] = [d === truthTurn ? dest : others.pop()];
  if (Math.random() < 0.5) s[pick(['left', 'straight', 'right'])].push(others.pop());
  const d = await decide({ type: 'junction', signal: 'green', crosser: null, trip: { dest, quote: pick(PLACES[dest]) }, sign: s, truthTurn });
  byDir[truthTurn][1]++;
  if (d.turn === truthTurn) { ok++; byDir[truthTurn][0]++; }
}
console.log(`turns ${ok}/${nSigns} | by correct direction: ` + Object.entries(byDir).map(([k, [a, b]]) => `${k} ${a}/${b}`).join(', '));
