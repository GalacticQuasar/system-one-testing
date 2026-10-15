#!/usr/bin/env python3
"""Serve the dino page and proxy /v1/systemone to Ollama (avoids browser CORS).

Usage:
    python3 server.py            # then open http://localhost:8000
    PORT=9000 python3 server.py
"""
import http.server
import os
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get("PORT", "8000"))
HOST = os.environ.get("OLLAMA_HOST", "http://localhost:11434").rstrip("/")
if not HOST.startswith("http"):
    HOST = "http://" + HOST


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def do_POST(self):
        if self.path != "/v1/systemone":
            self.send_error(404)
            return
        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        req = urllib.request.Request(
            f"{HOST}/v1/systemone", data=body, headers={"Content-Type": "application/json"}
        )
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                status, data = resp.status, resp.read()
        except urllib.error.HTTPError as e:
            status, data = e.code, e.read()
        except urllib.error.URLError as e:
            status, data = 502, f'{{"error": "cannot reach Ollama at {HOST}: {e.reason}"}}'.encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        if "/v1/systemone" not in (args[0] if args else ""):
            super().log_message(fmt, *args)


if __name__ == "__main__":
    print(f"Dino × System One → http://localhost:{PORT}  (Ollama at {HOST})")
    http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
