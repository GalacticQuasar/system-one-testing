// Headless benchmark. Runs the arcade with one of three classifiers:
//   model  - the System One model, in real time (latency matters)
//   oracle - ground-truth labels, instantly (the steering's ceiling)
//   random - random labels, instantly (the floor)
//
// Usage: node bench.mjs [model|oracle|random] [waves=14]
//   OLLAMA_HOST=http://localhost:11435 node bench.mjs model 14
import { createGame, step, steer, setLabel, nextToClassify, WAVE_S } from './game.js';
import { labelsFor } from './world.js';
import { Agent } from './agent.js';

const mode = process.argv[2] || 'model';
const waves = Number(process.argv[3] || 14);
const HOST = (process.env.OLLAMA_HOST || 'http://localhost:11434').replace(/\/$/, '');
const sleep = ms => new Promise(r => setTimeout(r, ms));

const g = createGame();
const total = waves * WAVE_S;
const lat = [];

if (mode === 'model') {
  const agent = new Agent({ endpoint: `${HOST}/v1/systemone`, model: process.env.MODEL });
  await agent.warmup(g.rule);
  let last = performance.now();
  const ticker = setInterval(() => {
    const now = performance.now();
    step(g, Math.min((now - last) / 1000, 0.05), steer(g));
    last = now;
  }, 1000 / 60);
  while (g.t < total) {
    const o = nextToClassify(g);
    if (!o) { await sleep(10); continue; }
    const wave = g.wave, rule = g.rule;
    const r = await agent.classify(rule, o);
    lat.push(r.ms);
    // Drop answers for a rule that has since changed or an object that's gone.
    if (g.wave === wave && g.objects.includes(o)) setLabel(g, o, r.label, r.probabilities);
  }
  clearInterval(ticker);
} else {
  const dt = 1 / 60;
  while (g.t < total) {
    for (let o; (o = nextToClassify(g));) {
      const labels = labelsFor(g.rule);
      const label = mode === 'oracle' ? g.rule.truth(o) : labels[Math.floor(Math.random() * labels.length)];
      setLabel(g, o, label, Object.fromEntries(labels.map(l => [l, l === label ? 1 : 0])));
    }
    step(g, dt, steer(g));
  }
}

const rows = g.waveStats;
const sum = k => rows.reduce((s, r) => s + r[k], 0);
console.log(`mode=${mode} waves=${rows.length}`);
for (const r of rows) {
  const acc = r.labelled ? `${Math.round(100 * r.labelledRight / r.labelled)}%` : '–';
  console.log(`${String(r.score).padStart(5)} pts | +${r.good} −${r.bad} missed ${r.missed} | labels ${acc.padStart(4)} | ${r.rule}`);
}
console.log(`\ntotal ${sum('score')} pts | collected ${sum('good')} | hit ${sum('bad')} bad | missed ${sum('missed')} | label accuracy ${(100 * sum('labelledRight') / Math.max(1, sum('labelled'))).toFixed(1)}%`);
if (lat.length) {
  lat.sort((a, b) => a - b);
  console.log(`model calls ${lat.length} | latency p50 ${lat[lat.length >> 1].toFixed(0)}ms p95 ${lat[Math.floor(lat.length * 0.95)].toFixed(0)}ms`);
}
