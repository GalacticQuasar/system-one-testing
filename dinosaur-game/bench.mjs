// Headless real-time benchmark: runs the game at 60 Hz wall-clock while the
// agent queries the model concurrently, exactly like the browser does.
//
// Usage: node bench.mjs [episodes=3] [style=semantic|raw] [maxSeconds=60]
import { createGame, step, observe } from './game.js';
import { Agent, apply } from './agent.js';

const HOST = (process.env.OLLAMA_HOST || 'http://localhost:11434').replace(/\/$/, '');
const episodes = Number(process.argv[2] || 3);
const style = process.argv[3] || 'semantic';
const maxSeconds = Number(process.argv[4] || 60);
const verbose = process.env.VERBOSE === '1';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const agent = new Agent({ endpoint: `${HOST}/v1/systemone`, model: process.env.MODEL, style });

async function episode() {
  const g = createGame();
  let last = performance.now();
  const ticker = setInterval(() => {
    const now = performance.now();
    step(g, Math.min((now - last) / 1000, 0.05));
    last = now;
    if (g.t >= maxSeconds) g.over = true;
  }, 1000 / 60);

  const lat = [];
  while (!g.over) {
    const obs = observe(g);
    if (obs.airborne) { await sleep(5); continue; }
    const d = await agent.decide(obs);
    if (g.over) break;
    apply(g, d.choice);
    lat.push(d.ms);
    if (verbose) console.log(`  t=${g.t.toFixed(2)} ${d.ms.toFixed(0).padStart(4)}ms ${d.choice.padEnd(4)} p=${JSON.stringify(Object.fromEntries(Object.entries(d.probabilities).map(([k, v]) => [k, +v.toFixed(2)])))} | ${d.state}`);
  }
  clearInterval(ticker);
  lat.sort((a, b) => a - b);
  return {
    score: Math.floor(g.score), seconds: g.t.toFixed(1), cleared: g.cleared,
    cause: g.cause || 'timeout', decisions: lat.length, jumps: g.jumps,
    p50: lat[lat.length >> 1]?.toFixed(0), p95: lat[Math.floor(lat.length * 0.95)]?.toFixed(0),
  };
}

console.log(`model=${agent.model} style=${style} episodes=${episodes} cap=${maxSeconds}s`);
await agent.warmup();
const results = [];
for (let i = 0; i < episodes; i++) {
  const r = await episode();
  results.push(r);
  console.log(`#${i + 1} score ${r.score} | ${r.seconds}s | cleared ${r.cleared} | died: ${r.cause} | ` +
    `${r.decisions} decisions, ${r.jumps} jumps | latency p50 ${r.p50}ms p95 ${r.p95}ms`);
}
const avg = results.reduce((s, r) => s + r.score, 0) / results.length;
console.log(`avg score ${avg.toFixed(0)}, avg cleared ${(results.reduce((s, r) => s + r.cleared, 0) / results.length).toFixed(1)}`);
