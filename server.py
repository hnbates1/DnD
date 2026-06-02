import json
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

VIDEO_EXTENSIONS = {".mp4", ".webm", ".mov", ".m4v", ".avi", ".mkv"}
OPENAI_URL = "https://api.openai.com/v1/responses"
DEFAULT_MODEL = "gpt-4o"


def load_local_env():
    for name in ("secrets.env", ".env"):
        path = Path.cwd() / name
        if not path.exists():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            clean = line.strip()
            if not clean or clean.startswith("#") or "=" not in clean:
                continue
            key, value = clean.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def write_json(handler, status, payload):
    body = json.dumps(payload).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def extract_response_text(payload):
    if payload.get("output_text"):
        return payload["output_text"]
    chunks = []
    for item in payload.get("output", []):
        for content in item.get("content", []):
            if content.get("type") in {"output_text", "text"} and content.get("text"):
                chunks.append(content["text"])
    return "\n".join(chunks).strip() or "No text response returned."


def build_ai_instructions(mode):
    base = (
        "You are a Dungeons & Dragons tabletop assistant embedded in a local map "
        "projection tool. Support the table without taking agency from players. "
        "Be concise, practical, and clearly separate rules certainty from judgment calls. "
        "If a rule may depend on edition, sourcebook, house rules, or missing character "
        "details, say what assumption you are making. Do not reveal private DM notes unless "
        "the DM asks for them or selects a DM-facing mode."
    )
    modes = {
        "rules": "Focus on rules adjudication, action economy, conditions, saves, checks, and fair rulings.",
        "hint": "Give subtle player-safe hints. Avoid spoilers and preserve discovery.",
        "dm": "Act as a temporary DM: describe scenes, propose consequences, keep pacing, and ask for rolls when needed.",
        "story": "Help with narration, atmosphere, NPC reactions, room descriptions, and encounter beats.",
        "combat": "Track tactical concerns, likely turns, terrain, targeting, visibility, and rule reminders.",
    }
    return f"{base}\n\nCurrent mode: {mode}. {modes.get(mode, modes['rules'])}"


def ask_openai(question, mode, context):
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return {
            "ok": False,
            "error": "OPENAI_API_KEY is not set. Rotate the exposed key, then set a fresh key in your environment or secrets.env.",
        }

    model = os.environ.get("OPENAI_MODEL", DEFAULT_MODEL)
    body = {
        "model": model,
        "instructions": build_ai_instructions(mode),
        "input": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "input_text",
                        "text": (
                            "Encounter context:\n"
                            f"{json.dumps(context, indent=2)}\n\n"
                            f"DM/player question:\n{question}"
                        ),
                    }
                ],
            }
        ],
        "max_output_tokens": 800,
    }
    request = Request(
        OPENAI_URL,
        data=json.dumps(body).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=45) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        return {"ok": False, "error": f"OpenAI request failed: HTTP {exc.code} {detail}"}
    except URLError as exc:
        return {"ok": False, "error": f"Could not reach OpenAI: {exc.reason}"}
    except TimeoutError:
        return {"ok": False, "error": "OpenAI request timed out."}

    return {
        "ok": True,
        "model": model,
        "answer": extract_response_text(payload),
    }


class DnDHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/api/media":
            media_dir = Path.cwd() / "media"
            media_dir.mkdir(exist_ok=True)
            files = [
                {
                    "name": path.name,
                    "url": f"media/{path.name}",
                }
                for path in sorted(media_dir.iterdir())
                if path.is_file() and path.suffix.lower() in VIDEO_EXTENSIONS
            ]
            write_json(self, 200, files)
            return
        if self.path == "/api/ai/status":
            write_json(self, 200, {
                "configured": bool(os.environ.get("OPENAI_API_KEY")),
                "model": os.environ.get("OPENAI_MODEL", DEFAULT_MODEL),
            })
            return
        super().do_GET()

    def do_POST(self):
        if self.path != "/api/ai":
            self.send_error(404)
            return

        length = int(self.headers.get("Content-Length", "0"))
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
        except json.JSONDecodeError:
            write_json(self, 400, {"ok": False, "error": "Invalid JSON body."})
            return

        question = str(payload.get("question", "")).strip()
        mode = str(payload.get("mode", "rules")).strip() or "rules"
        context = payload.get("context", {})
        if not question:
            write_json(self, 400, {"ok": False, "error": "Ask a question first."})
            return

        result = ask_openai(question, mode, context)
        write_json(self, 200 if result.get("ok") else 503, result)

    def end_headers(self):
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def main():
    load_local_env()
    root = Path(__file__).resolve().parent
    port = 8765
    server = ThreadingHTTPServer(("127.0.0.1", port), DnDHandler)
    print(f"DnD crawl system running at http://127.0.0.1:{port}")
    print(f"Serving files from {root}")
    server.serve_forever()


if __name__ == "__main__":
    main()
