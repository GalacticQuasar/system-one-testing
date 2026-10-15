// Offline accuracy check: how well does the model follow each rule?
// Usage: node probe.mjs [samplesPerRule=24]
import { RULES, randomTraits } from './world.js';
import { Agent } from './agent.js';

const HOST = (process.env.OLLAMA_HOST || 'http://localhost:11434').replace(/\/$/, '');
import { readFileSync, readdirSync } from 'node:fs';
// Optional (RSS=1): report the Ollama runner's memory, which has been seen to bloat.
function rss() {
  for (const pid of readdirSync('/proc').filter(d => /^\d+$/.test(d))) {
    try {
      if (readFileSync(`/proc/${pid}/comm`, 'utf8').trim() !== 'llama-server') continue;
      const kb = Number(/VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${pid}/status`, 'utf8'))[1]);
      return `[runner ${(kb / 1048576).toFixed(1)} GB]`;
    } catch {}
  }
  return '';
}
const n = Number(process.argv[2] || 24);
const agent = new Agent({ endpoint: `${HOST}/v1/systemone`, model: process.env.MODEL });
await agent.warmup(RULES[0]);

let total = 0, right = 0;
const lat = [];
const bins = Array.from({ length: 5 }, () => ({ n: 0, right: 0 }));  // calibration by top probability
for (const rule of RULES) {
  let r = 0;
  const misses = [];
  for (let i = 0; i < n; i++) {
    const o = randomTraits();
    const want = rule.truth(o);
    const got = await agent.classify(rule, o);
    lat.push(got.ms);
    const ok = got.label === want;
    r += ok;
    const p = got.probabilities[got.label];
    const b = bins[Math.min(4, Math.floor(p * 5))];
    b.n++; b.right += ok;
    if (!ok && misses.length < 3) misses.push(`${o.size} ${o.color} ${o.noun}${o.fast ? ' (fast)' : ''}: want ${want}, got ${got.label}`);
  }
  total += n; right += r;
  console.log(`${String(Math.round(100 * r / n)).padStart(3)}%  ${rule.text}  ${process.env.RSS ? rss() : ''}`);
  for (const m of misses) console.log(`       ✗ ${m}`);
}
lat.sort((a, b) => a - b);
console.log(`\noverall ${(100 * right / total).toFixed(1)}% of ${total} | latency p50 ${lat[lat.length >> 1].toFixed(0)}ms p95 ${lat[Math.floor(lat.length * 0.95)].toFixed(0)}ms`);
console.log('calibration (top-choice probability → accuracy):');
bins.forEach((b, i) => b.n && console.log(`  ${(i * 0.2).toFixed(1)}–${((i + 1) * 0.2).toFixed(1)}: ${(100 * b.right / b.n).toFixed(0)}% right (n=${b.n})`));
