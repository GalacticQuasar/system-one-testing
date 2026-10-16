# System One testing

Experiments with a local System One model (`tev1:0.8b`) through Ollama's `/v1/systemone` endpoint.

| | What | Port |
|---|---|---|
| `demo.py` | Support-ticket triage, one request with several question types | – |
| `dinosaur-game/` | Chrome-dino runner, the model picks run / jump / duck | 8000 |
| `rule-arcade/` | Collect/dodge game whose rule changes every wave, the model labels objects | 8001 |
| `car-game/` | 2D car: city driving decisions and track steering | 8002 |

## Run

```bash
ollama pull tev1:0.8b
python3 demo.py
cd <game> && python3 server.py      # stop with Ctrl+C
```

Each game folder has its own README with details and results.

## ⚠️ Ollama memory growth note

Ollama's bundled `llama-server` keeps a RAM prompt cache (default cap 8 GB). Every
*distinct* prompt adds roughly 37 MB, and the games send many distinct prompts (every object
in `rule-arcade` is one), so on the current machine (7.8 GB RAM) the runner fills RAM within minutes,
starts swapping, and slows down.

**Permanent fix** (disables that cache for the system service):

```bash
sudo systemctl edit ollama
#   add:
#   [Service]
#   Environment="LLAMA_ARG_CACHE_RAM=0"
sudo systemctl restart ollama
```

**Without sudo**: run a second, user-level Ollama with the cache off and point a game at it:

```bash
OLLAMA_HOST=127.0.0.1:11435 OLLAMA_MODELS=/usr/share/ollama/.ollama/models \
  LLAMA_ARG_CACHE_RAM=0 ollama serve
```

**Quick reset** (frees the memory; the model reloads on the next call):
`curl localhost:11434/api/generate -d '{"model":"tev1:0.8b","keep_alive":0}'`
