# Dino × System One

Chrome-dino-style runner played by a local System One model (`tev1:0.8b` via Ollama's
`/v1/systemone`). Each decision is one `choice` question (run / jump / duck) about a text
description of the next obstacle. Clears ~12–20 obstacles per run.

Caveat: in the default "semantic" state the harness pre-computes time-to-impact and labels it
("IMMINENT"), so most of the work is done before the model is asked. Switch the page to
"raw" state to see the model fail without that help. See `../rule-arcade/` for a follow-up.

## Run

```bash
cd dinosaur-game
python3 server.py      # → http://localhost:8000
```

Stop with **Ctrl+C**, or `pkill -f "python3 server.py"` if it's in the background.
Headless benchmark: `node bench.mjs [games=3] [semantic|raw]`.

If games get slow, Ollama's runner has probably filled RAM with its prompt cache; see the
"Ollama memory growth" section in `../rule-arcade/README.md`.
