"""OpenAI-Images-compatible bridge over the InfiniteWebtoons SDXL pipeline.

The harness's `openai` image adapter talks to this server exactly as it would to OpenAI:

  POST /v1/images/generations  JSON {model, prompt, size, n}            -> text to image
  POST /v1/images/edits        multipart {model, prompt, size, image[]} -> files named `source-*` are the image to
                               edit (SDXL img2img); files named `reference-*` are character references (IP-Adapter)
  GET  /v1/models, GET /health

Responses are `{"created": ..., "data": [{"b64_json": "<png>"}]}`. One job runs on the GPU at a time.

Run it with the InfiniteWebtoons environment (it imports that project's pipeline and reads its configs/.env):

  uv run --project E:\\claude\\InfiniteWebtoons python tools/local-models/image_server.py
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import random
import sys
import threading
import time
import traceback
import urllib.request
from email.parser import BytesParser
from email.policy import HTTP
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

MODEL_ID = "sdxl-webtoon"
# SDXL is trained on ~1 MP buckets; the harness asks for OpenAI sizes (1024x1536 ...), so map by aspect ratio.
SDXL_BUCKETS = [(1024, 1024), (832, 1216), (1216, 832), (896, 1152), (1152, 896), (768, 1344), (1344, 768)]


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=7861)
    p.add_argument("--infinite-root", default=r"E:\claude\InfiniteWebtoons", help="InfiniteWebtoons checkout")
    p.add_argument("--steps", type=int, default=None, help="override configs/generate.yaml steps")
    p.add_argument("--offload", choices=["model", "sequential"], default="sequential",
                   help="model: faster, needs ~6 GB free VRAM; sequential: ~2 GB VRAM, slower per step (default; "
                        "desktop apps often hold several GB of an 8 GB card, and spilling into shared memory is far slower)")
    p.add_argument("--scale", type=float, default=1.0, help="resolution multiplier on the ~1 MP SDXL sizes (e.g. 0.75)")
    p.add_argument("--edit-strength", type=float, default=0.6, help="img2img strength for edits (0..1)")
    p.add_argument("--ollama-url", default="http://localhost:11434")
    p.add_argument("--keep-ollama", action="store_true", help="do not unload Ollama models before generating")
    p.add_argument("--lazy", action="store_true", help="load the pipeline on the first request instead of at start")
    return p.parse_args()


def log(msg: str) -> None:
    print(f"[image-server {time.strftime('%H:%M:%S')}] {msg}", flush=True)


class Engine:
    """Owns the SDXL pipeline. Not thread-safe by itself: callers hold `lock`."""

    def __init__(self, args: argparse.Namespace):
        self.args = args
        self.lock = threading.Lock()
        self.gen = None
        self.img2img = None
        self.cfg = None
        self.status = "starting"
        self.error: str | None = None

    def load(self) -> None:
        root = Path(self.args.infinite_root)
        sys.path.insert(0, str(root / "src"))
        from webtoon.config import load_generate_cfg  # noqa: E402  (also loads InfiniteWebtoons/.env -> HF_HOME)
        from webtoon.generate.panel_gen import PanelGenerator  # noqa: E402

        self.cfg = load_generate_cfg()
        if self.args.steps:
            self.cfg.steps = self.args.steps
        self.status = "loading"
        log(f"loading {self.cfg.base_model} + IP-Adapter + LoRA {self.cfg.lora_path} (first run can take minutes)")
        self.gen = PanelGenerator(self.cfg, log=log)
        if self.args.offload == "sequential":
            pipe = self.gen.pipe
            pipe.remove_all_hooks()  # PanelGenerator enabled model offload; swap it for per-layer offload
            pipe.enable_sequential_cpu_offload()
            log("sequential CPU offload enabled")
        self.status = "ready"
        log("ready")

    def ensure(self) -> None:
        if self.gen is None:
            self.load()

    # ------------------------------------------------------------------ helpers

    def free_ollama(self) -> None:
        """SDXL and a local LLM do not both fit in 8 GB: ask Ollama to unload whatever it has resident."""
        if self.args.keep_ollama:
            return
        base = self.args.ollama_url.rstrip("/")
        try:
            with urllib.request.urlopen(f"{base}/api/ps", timeout=3) as r:
                running = [m.get("model") or m.get("name") for m in json.load(r).get("models", [])]
        except Exception:
            return  # Ollama not running: nothing to free
        for name in filter(None, running):
            try:
                body = json.dumps({"model": name, "keep_alive": 0}).encode()
                req = urllib.request.Request(f"{base}/api/generate", data=body, headers={"content-type": "application/json"})
                urllib.request.urlopen(req, timeout=30).read()
                log(f"unloaded Ollama model {name} to free VRAM")
            except Exception as e:  # best effort
                log(f"could not unload {name}: {e}")

    def size_for(self, size: str | None) -> tuple[int, int]:
        try:
            w, h = (int(x) for x in str(size).lower().split("x"))
        except Exception:
            w, h = 1024, 1024
        want = w / h
        bw, bh = min(SDXL_BUCKETS, key=lambda b: abs(b[0] / b[1] - want))
        snap = lambda v: max(512, int(round(v * self.args.scale / 64)) * 64)  # SDXL wants multiples of 64
        return snap(bw), snap(bh)

    # The harness's reference-sheet prompts ask for "even studio lighting"; SDXL tends to draw the studio itself.
    EXTRA_NEGATIVE = "light stand, studio equipment, microphone, softbox, tripod"

    def prompts(self, prompt: str) -> tuple[str, str]:
        cfg = self.cfg
        trigger = cfg.lora_trigger if cfg.lora_path else ""
        positive = ", ".join(p for p in (trigger, cfg.style_prompt, prompt.strip()) if p)
        return positive, f"{cfg.negative_prompt}, {self.EXTRA_NEGATIVE}"

    # ------------------------------------------------------------------ generation

    def generate(self, prompt: str, size: str | None, refs: list, source, seed: int | None):
        self.ensure()  # puts InfiniteWebtoons/src on sys.path
        import torch
        from PIL import Image
        from webtoon.generate.panel_gen import encode_long, square_pad

        self.free_ollama()
        W, H = self.size_for(size)
        positive, negative = self.prompts(prompt)
        pipe = self.gen.pipe
        if refs:
            ip_images = [square_pad(r.convert("RGB")) for r in refs]
            pipe.set_ip_adapter_scale(self.cfg.ip_adapter.scale)
        else:  # IP-Adapter is loaded, so it needs an image: a blank one at scale 0
            ip_images = [Image.new("RGB", (224, 224), "white")]
            pipe.set_ip_adapter_scale(0.0)
        seed = seed if seed is not None else random.randint(0, 2**31 - 1)
        started = time.time()

        def progress(_pipe, step, _t, kwargs):
            if step == 0 or (step + 1) % 5 == 0:
                log(f"  step {step + 1}/{self.cfg.steps} after {time.time() - started:.0f}s")
            return kwargs

        common = dict(
            callback_on_step_end=progress,
            num_inference_steps=self.cfg.steps,
            guidance_scale=self.cfg.guidance,
            ip_adapter_image=[ip_images],
            generator=torch.Generator("cpu").manual_seed(seed),
        )
        if torch.cuda.is_available():
            torch.cuda.reset_peak_memory_stats()
        t0 = time.time()
        if source is not None:
            img2img = self._img2img()
            pe, npe, pooled, npooled = encode_long(img2img, positive, negative)
            image = img2img(
                prompt_embeds=pe, negative_prompt_embeds=npe, pooled_prompt_embeds=pooled, negative_pooled_prompt_embeds=npooled,
                image=source.convert("RGB").resize((W, H)), strength=self.args.edit_strength, **common,
            ).images[0]
        else:
            pe, npe, pooled, npooled = encode_long(pipe, positive, negative)
            image = pipe(
                prompt_embeds=pe, negative_prompt_embeds=npe, pooled_prompt_embeds=pooled, negative_pooled_prompt_embeds=npooled,
                width=W, height=H, **common,
            ).images[0]
        vram = round(torch.cuda.max_memory_allocated() / 1e9, 2) if torch.cuda.is_available() else None
        log(f"{'edit' if source is not None else 'generate'} {W}x{H} refs={len(refs)} seed={seed} in {time.time() - t0:.1f}s peak_vram={vram}GB")
        return image

    def _img2img(self):
        if self.img2img is None:
            from diffusers import StableDiffusionXLImg2ImgPipeline

            # Shares every component (and the loaded IP-Adapter/LoRA) with the text-to-image pipeline.
            self.img2img = StableDiffusionXLImg2ImgPipeline.from_pipe(self.gen.pipe)
            self.img2img.set_progress_bar_config(disable=True)
        return self.img2img


def png_b64(image) -> str:
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode()


def make_handler(engine: Engine):
    from PIL import Image

    class Handler(BaseHTTPRequestHandler):
        server_version = "webtoon-image-server/1"

        def log_message(self, fmt, *a):  # quieter default logging
            log(f"{self.command} {self.path} -> {fmt % a}")

        def _json(self, code: int, body: dict) -> None:
            data = json.dumps(body).encode()
            self.send_response(code)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def _error(self, code: int, message: str) -> None:
            self._json(code, {"error": {"message": message, "type": "invalid_request_error" if code < 500 else "server_error"}})

        def do_GET(self):
            if self.path.rstrip("/") == "/health":
                return self._json(200, {"status": engine.status, "model": MODEL_ID, "error": engine.error,
                                        "lora": engine.cfg.lora_path if engine.cfg else None})
            if self.path.rstrip("/") == "/v1/models":
                return self._json(200, {"object": "list", "data": [{"id": MODEL_ID, "object": "model", "owned_by": "local"}]})
            self._error(404, f"Unknown path {self.path}")

        def _body(self) -> bytes:
            return self.rfile.read(int(self.headers.get("content-length") or 0))

        def do_POST(self):
            path = self.path.rstrip("/")
            try:
                if path == "/v1/images/generations":
                    body = json.loads(self._body() or b"{}")
                    prompt, size, seed = body.get("prompt"), body.get("size"), body.get("seed")
                    refs, source = [], None
                elif path == "/v1/images/edits":
                    prompt, size, seed, refs, source = self._parse_edit()
                else:
                    return self._error(404, f"Unknown path {self.path}")
                if not isinstance(prompt, str) or not prompt.strip():
                    return self._error(400, "prompt is required")
                with engine.lock:
                    image = engine.generate(prompt, size, refs, source, int(seed) if seed not in (None, "") else None)
                self._json(200, {"created": int(time.time()), "data": [{"b64_json": png_b64(image)}]})
            except ValueError as e:
                self._error(400, str(e))
            except Exception as e:  # report, keep serving
                traceback.print_exc()
                self._error(500, f"Generation failed: {e}")

        def _parse_edit(self):
            ctype = self.headers.get("content-type", "")
            if "multipart/form-data" not in ctype:
                raise ValueError("images/edits expects multipart/form-data")
            msg = BytesParser(policy=HTTP).parsebytes(b"content-type: " + ctype.encode() + b"\r\n\r\n" + self._body())
            fields, refs, source = {}, [], None
            for part in msg.iter_parts():
                name = part.get_param("name", header="content-disposition") or ""
                filename = part.get_filename()
                payload = part.get_payload(decode=True) or b""
                if filename is None:
                    fields[name] = payload.decode("utf-8", "replace")
                    continue
                if not name.startswith("image"):
                    continue
                try:
                    img = Image.open(io.BytesIO(payload))
                    img.load()
                except Exception as e:
                    raise ValueError(f"Unreadable image {filename}: {e}")
                # The harness names the image being edited `source-*` and character references `reference-*`.
                if filename.startswith("source") and source is None:
                    source = img
                else:
                    refs.append(img)
            return fields.get("prompt"), fields.get("size"), fields.get("seed"), refs, source

    return Handler


def main() -> None:
    args = parse_args()
    engine = Engine(args)
    server = ThreadingHTTPServer((args.host, args.port), make_handler(engine))
    log(f"listening on http://{args.host}:{args.port}/v1 (model id '{MODEL_ID}')")
    if not args.lazy:
        def preload():
            try:
                with engine.lock:
                    engine.load()
            except Exception as e:
                engine.status, engine.error = "error", str(e)
                traceback.print_exc()
        threading.Thread(target=preload, daemon=True).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log("stopping")


if __name__ == "__main__":
    main()
