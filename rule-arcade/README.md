# Rule Arcade

A top-down collect/dodge game where the rule changes every 25-second wave
("Collect anything red", "Avoid animals", "Collect anything you'd find in a kitchen"…).
A local System One model (`tev1:0.8b` via Ollama's `/v1/systemone`) reads the rule
and labels each object **collect / avoid / ignore** with probabilities; plain
steering code turns the labels into movement. The model never sees positions, and
the steering never reads the rule.

## Run

Needs Ollama running with `tev1:0.8b` pulled (`ollama pull tev1:0.8b`).

```bash
cd rule-arcade
python3 server.py                 # → http://localhost:8001
```

Stop it with **Ctrl+C** in that terminal. If it was started in the background:
`pkill -f "python3 server.py"`. (This also stops the dino server if that's running.)

Use a different Ollama (e.g. the cache-disabled one below):
`OLLAMA_HOST=http://localhost:11435 python3 server.py`. Change the port with `PORT=9000`.

On the page: **Model plays**, **Oracle plays** (true labels: the best the steering can do), or
**You play** (arrow keys / WASD, with the model's labels drawn as hints).

## ⚠️ Ollama memory growth

Ollama's bundled `llama-server` keeps a RAM prompt cache (default cap 8 GB). Every
*distinct* prompt adds roughly 37 MB, and every object here is a distinct prompt, so on
this machine (7.8 GB RAM) the runner fills RAM within minutes, starts swapping, and slows down.

**Permanent fix** (disables that cache for the system service):

```bash
sudo systemctl edit ollama
#   add:
#   [Service]
#   Environment="LLAMA_ARG_CACHE_RAM=0"
sudo systemctl restart ollama
```

**Without sudo**: run a second, user-level Ollama with the cache off and point the game at it:

```bash
OLLAMA_HOST=127.0.0.1:11435 OLLAMA_MODELS=/usr/share/ollama/.ollama/models \
  LLAMA_ARG_CACHE_RAM=0 ollama serve
```

**Quick reset** (frees the memory; the model reloads on the next call):
`curl localhost:11434/api/generate -d '{"model":"tev1:0.8b","keep_alive":0}'`

## Measure

```bash
node probe.mjs 24            # per-rule label accuracy + calibration, no game
node bench.mjs oracle 28     # steering ceiling (instant, true labels)
node bench.mjs random 28     # floor (instant, random labels)
OLLAMA_HOST=http://localhost:11435 node bench.mjs model 14   # real time, ~6 min
```

## Files

| File | What |
|---|---|
| `world.js` | object catalog, the rules, ground truth (`truth`), which labels each rule offers |
| `agent.js` | the model call: rule + object description → `choice` question |
| `game.js` | simulation, scoring, steering controller |
| `index.html` | the page |
| `server.py` | static server + proxy to Ollama (port 8001) |
| `bench.mjs`, `probe.mjs` | headless measurements |

To add a rule, append `{ text, truth }` to `RULES` in `world.js`. Only offer "ignore"
by using the word *ignore* in the rule text; otherwise the model leans on it as a catch-all.
