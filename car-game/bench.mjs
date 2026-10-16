// Headless benchmark for both modes. With `model` the game runs at 60 Hz
// wall-clock while the agent queries the model concurrently, exactly like the
// browser; `oracle` and `random` answer instantly and run as fast as possible.
//
// Usage:
//   node bench.mjs city  [model|oracle|random] [seconds=90]
//   node bench.mjs track [model|oracle] [semantic|raw] [seconds=60] [slow|medium|fast]
//   OLLAMA_HOST=http://localhost:11435 node bench.mjs city model 120
import * as city from './city.js';
import * as track from './track.js';
import { Agent, cityQuery, cityDecision, trackState, trackSteer, TRACK_QUESTIONS } from './agent.js';

const [mode = 'city', who = 'model'] = process.argv.slice(2);
const HOST = (process.env.OLLAMA_HOST || 'http://localhost:11434').replace(/\/$/, '');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const agent = new Agent({ endpoint: `${HOST}/v1/systemone`, model: process.env.MODEL });
const lat = [];

// Step `g` at 60 Hz wall-clock until `done()`; returns a stop function.
function realtime(g, stepFn) {
  let last = performance.now();
  const id = setInterval(() => {
    const now = performance.now();
    stepFn(g, Math.min((now - last) / 1000, 0.05));
    last = now;
  }, 1000 / 60);
  return () => clearInterval(id);
}

const pct = t => t.n ? `${Math.round(100 * t.ok / t.n)}% (${t.ok}/${t.n})` : '–';

if (mode === 'city') {
  const seconds = Number(process.argv[4] || 90);
  const g = city.createGame();
  if (who === 'model') {
    await agent.warmup();
    const stop = realtime(g, city.step);
    while (g.t < seconds) {
      const ev = city.nextToDecide(g);
      if (!ev) { await sleep(10); continue; }
      ev.pending = true;
      const rs = await Promise.all(cityQuery(g, ev).map(c => agent.ask(c.state, c.questions)));
      ev.pending = false;
      lat.push(Math.max(...rs.map(r => r.ms)));
      city.setDecision(g, ev, cityDecision(ev, Object.assign({}, ...rs.map(r => r.answers))));
    }
    stop();
  } else {
    const decide = who === 'oracle' ? city.oracleDecision : city.randomDecision;
    while (g.t < seconds) {
      for (let ev; (ev = city.nextToDecide(g));) city.setDecision(g, ev, decide(ev));
      city.step(g, 1 / 60);
    }
  }
  const bad = g.outcomes.filter(o => !o.ok);
  console.log(`city who=${who} ${seconds}s | score ${g.score} | blocks ${g.blocks} | trips ${g.trips}`);
  console.log(`hazards ${pct(g.tally.hazard)} | intersections go/stop ${pct(g.tally.junction)} | turns ${pct(g.tally.route)}`);
  if (bad.length) console.log('mistakes:\n  ' + bad.map(o => `${String(o.pts).padStart(4)}  ${o.text}`).join('\n  '));
} else {
  const style = process.argv[4] || 'semantic';
  const seconds = Number(process.argv[5] || 60);
  const g = track.createGame(track.SPEEDS[process.argv[6] || 'medium']);
  if (who === 'model') {
    await agent.warmup();
    const stop = realtime(g, track.step);
    while (g.t < seconds) {
      const obs = track.observe(g, 0.6 + agent.latency);
      const { answers, ms } = await agent.ask(trackState(obs, style), TRACK_QUESTIONS);
      lat.push(ms);
      g.command = trackSteer(answers);
    }
    stop();
  } else {
    for (let i = 0; g.t < seconds; i++) {
      if (i % 6 === 0) g.command = track.oracleSteer(track.observe(g, 0.6));  // ~10 decisions/s
      track.step(g, 1 / 60);
    }
  }
  console.log(`track who=${who} style=${style} speed=${g.speed}px/s ${seconds}s | laps ${g.progress.toFixed(2)} | crashes ${g.crashes} ` +
    `(${(g.crashes / Math.max(g.progress, 0.01)).toFixed(1)} per lap)`);
  for (const [i, l] of g.laps.entries()) console.log(`  lap ${i + 1}: ${l.time.toFixed(1)}s, ${l.crashes} crashes`);
}
if (lat.length) {
  lat.sort((a, b) => a - b);
  console.log(`model calls ${lat.length} | latency p50 ${lat[lat.length >> 1].toFixed(0)}ms p95 ${lat[Math.floor(lat.length * 0.95)].toFixed(0)}ms`);
}
