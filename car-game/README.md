# Car × System One

A local System One model (`tev1:0.8b` via Ollama's `/v1/systemone`) drives a 2D car, in two modes:

- **City**: top-down streets. Plain code keeps the car in its lane, sets the speed, brakes for anything
  not yet decided and drives the turns. The model makes the calls a driver makes by understanding the
  scene, each from a one-line text fact:
  - something in the lane → `is_living` (noul) + `hard_or_soft` (choice) → stop / steer around / drive over
  - intersection → three parallel calls: `may_enter` (traffic light, police officer…), `someone_crossing`
    (crosswalk), `route` (passenger says *"I have a flight to catch"*, the signpost lists the places)
- **Track**: a loop road, where the model steers directly. Each decision is one `score` question
  (hard left … hard right), held until the next answer.
  - *semantic*: the harness says where the road goes (*"The road veers slightly left."*). That's most of
    the problem solved before the model sees it, like the dino's "IMMINENT" label.
  - *raw*: the five sensor distances in pixels. The model can't compare numbers, so this fails.

## Run

Uses the cache-disabled Ollama on port 11435 by default (see "Ollama memory growth" in
`../rule-arcade/README.md`). Start it first:

```bash
OLLAMA_HOST=127.0.0.1:11435 OLLAMA_MODELS=/usr/share/ollama/.ollama/models \
  LLAMA_ARG_CACHE_RAM=0 ollama serve
```

Then:

```bash
cd car-game
python3 server.py                 # → http://localhost:8002
OLLAMA_HOST=http://localhost:11434 python3 server.py   # or use the system Ollama
```

On the page: **Model**, **Oracle** (ground-truth answers in city, pure-pursuit code on the track),
**Random** (city), **You** (track, ← →).

## Results (this machine)

| | score / crashes | per-question accuracy | call latency p50 |
|---|---|---|---|
| City, model, 120 s | 436 pts, 6 trips | in-lane 63% · go/stop 97% · turns 95% | 426 ms (3 parallel calls) |
| City, oracle | ≈ 710 pts per 120 s | 100% | – |
| City, random | negative | ≈ 40% · 49% · 33% | – |
| Track semantic, model | 0.4 crashes / lap | – | 139 ms |
| Track raw, model | 27 crashes / lap | – | 186 ms |
| Track, pure-pursuit code | 0 crashes / lap | – | – |

`probe.mjs` (no game, every hazard and signal × crosswalk combination): hazards 20/24, go/stop 45/48,
turns 30/30. The remaining misses are things like a mattress or shopping cart called "soft", a manhole
cover called "hard", and a dog *sitting on the sidewalk* read as crossing.

What changed the numbers while building this (all measured with the probes):

- **One fact per call.** With the light, the crosswalk and the passenger in one `state`, go/stop was
  64% and turns 50%. Split into three calls: 97% and 95%.
- **Question keys are part of the prompt.** `crossing` answers 0.54 "yes" for an empty crosswalk;
  `someone_crossing` answers 0.21. `living`/`solid` → `is_living`/`hard_or_soft`: 18 → 20 of 24 hazards.
- **Option wording.** `"Turn right, toward the Zoo"` made the model avoid "right" (4/9).
  `"The Zoo (turn right)"`: 36/36.
- **Decompose, then combine in code.** Asking stop/around/over directly leans on "drive over";
  two facts (living? hard?) combined by code do better.

## Measure

```bash
export OLLAMA_HOST=http://localhost:11435
node probe.mjs 30                            # per-question accuracy, no game
node bench.mjs city model 120                # real time
node bench.mjs city oracle 300               # ceiling (instant)
node bench.mjs track model semantic 60       # real time; also: raw, and slow|medium|fast
node bench.mjs track oracle semantic 120
```

## Files

| File | What |
|---|---|
| `city.js` | city simulation: streets, hazards, signals, signposts, ground truth, scoring, the driving code |
| `track.js` | loop track, car physics, sensors, pure-pursuit oracle |
| `agent.js` | the model calls: facts → `state` + questions, answers → decision, for both modes |
| `index.html` | the page |
| `server.py` | static server + proxy to Ollama (port 8002, Ollama 11435) |
| `bench.mjs`, `probe.mjs` | headless measurements |
