"""
llm.py — OpenAI-compatible chat clients for the split brain (05 D-A..D-E).

- PlannerClient: the organiser (hosted model; currently defaults to the same
  endpoint as the Writer = single-brain, swappable via PLANNER_* env).
- WriterClient: the abliterated copy model. Blind and stateless — it only ever
  receives a narrow brief (D-C) and returns copy. Its optional secondary uses
  the same guarded brief and never handles strike copy or page HTML.
- Stdlib urllib only. Robust JSON extraction for weaker models.
"""
from __future__ import annotations

import json
import time
import urllib.request
import urllib.error
from typing import Optional

TIMEOUT = 240.0
MAX_RETRIES = 2


class LLMError(Exception):
    pass


def extract_json(text: str):
    """Pull the first balanced JSON object/array out of model output, tolerating
    code fences and surrounding prose (weak models wrap JSON)."""
    t = text.strip()
    if t.startswith("```"):
        # strip fenced block(s)
        lines = t.splitlines()
        lines = [l for l in lines if not l.strip().startswith("```")]
        t = "\n".join(lines).strip()
    for opener, closer in (("{", "}"), ("[", "]")):
        start = t.find(opener)
        while start != -1:
            depth = 0
            in_str = False
            esc = False
            for i in range(start, len(t)):
                ch = t[i]
                if in_str:
                    if esc:
                        esc = False
                    elif ch == "\\":
                        esc = True
                    elif ch == '"':
                        in_str = False
                    continue
                if ch == '"':
                    in_str = True
                elif ch == opener:
                    depth += 1
                elif ch == closer:
                    depth -= 1
                    if depth == 0:
                        chunk = t[start : i + 1]
                        try:
                            return json.loads(chunk)
                        except json.JSONDecodeError:
                            break  # balanced but invalid -> try the next chunk
            start = t.find(opener, start + 1)
    raise LLMError(f"no JSON found in model output: {text[:300]}")


def _unwrap(obj):
    if isinstance(obj, list) and len(obj) == 1 and isinstance(obj[0], dict):
        return obj[0]
    return obj


class ChatClient:
    """One OpenAI-compatible /chat/completions endpoint."""

    def __init__(self, base_url: str, model: str, api_key: str, name: str = "llm"):
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.api_key = api_key
        self.name = name

    def chat(self, messages: list, temperature: float = 0.4,
             max_tokens: int = 2048, want_json: bool = False,
             max_retries: int = MAX_RETRIES) -> str:
        payload = {
            "model": self.model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        # Qwen3-thinking suppression: only the local llama.cpp server accepts this.
        # The hosted gateway (LiteLLM) rejects it as a provider/runtime control (HTTP 400).
        if "localhost" in self.base_url or "127.0.0.1" in self.base_url:
            payload["chat_template_kwargs"] = {"enable_thinking": False}
        if want_json:
            payload["response_format"] = {"type": "json_object"}
        data = json.dumps(payload).encode("utf-8")
        last = None
        for attempt in range(max_retries + 1):
            req = urllib.request.Request(
                self.base_url + "/chat/completions", data=data, method="POST"
            )
            req.add_header("Content-Type", "application/json")
            req.add_header("Authorization", f"Bearer {self.api_key}")
            # Cloudflare in front of the gateway bans the default Python-urllib UA (403/1010)
            req.add_header("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36")
            req.add_header("Accept", "application/json")
            try:
                with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                    out = json.loads(resp.read().decode("utf-8"))
                choice = out["choices"][0]
                content = choice["message"].get("content")
                if content is None and choice.get("finish_reason") == "length" \
                        and attempt < max_retries:
                    # Reasoning models can spend the whole completion budget before
                    # emitting content. Retry the same request with more headroom.
                    payload["max_tokens"] *= 2
                    data = json.dumps(payload).encode("utf-8")
                    continue
                if not isinstance(content, str):
                    raise LLMError(
                        f"{self.name} returned no text content "
                        f"(finish_reason={choice.get('finish_reason')})")
                return content
            except urllib.error.HTTPError as e:
                body = ""
                try:
                    body = e.read().decode("utf-8", "replace")
                except Exception:
                    pass
                # response_format unsupported on some servers -> retry without it
                if e.code == 400 and want_json and "response_format" in body.lower() \
                        and attempt < max_retries:
                    payload.pop("response_format", None)
                    data = json.dumps(payload).encode("utf-8")
                    want_json = False
                    continue
                last = LLMError(f"{self.name} HTTP {e.code}: {body[:300]}")
                if e.code in (429, 500, 502, 503, 504) and attempt < max_retries:
                    time.sleep(3 * (attempt + 1))
                    continue
                raise last
            except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
                last = LLMError(f"{self.name} network error: {e}")
                if attempt < max_retries:
                    time.sleep(3 * (attempt + 1))
                    continue
        raise last or LLMError(f"{self.name}: unknown failure")

    def chat_json(self, messages: list, temperature: float = 0.3,
                  max_tokens: int = 2048, repair: bool = True,
                  max_retries: int = MAX_RETRIES):
        """Chat once and parse JSON, with one repair retry if parsing fails.
        Single-element JSON arrays wrapping an object are unwrapped (weak-model tic)."""
        raw = self.chat(messages, temperature=temperature, max_tokens=max_tokens,
                        want_json=True, max_retries=max_retries)
        try:
            return _unwrap(extract_json(raw)), raw
        except LLMError:
            if not repair:
                raise
            repair_messages = messages + [
                {"role": "assistant", "content": raw[:1500]},
                {"role": "user", "content":
                 "That was not valid JSON. Reply with ONLY the JSON object, no prose, "
                 "no code fences."},
            ]
            raw2 = self.chat(repair_messages, temperature=0.1, max_tokens=max_tokens,
                             want_json=True, max_retries=max_retries)
            return _unwrap(extract_json(raw2)), raw2


def planner_client(cfg) -> ChatClient:
    return ChatClient(cfg.planner_base_url, cfg.planner_model, cfg.planner_api_key,
                      name="planner")


def planner_fallback_client(cfg) -> ChatClient:
    return ChatClient(
        getattr(cfg, "planner_fallback_base_url", None) or cfg.writer_base_url,
        getattr(cfg, "planner_fallback_model", None) or cfg.writer_model,
        getattr(cfg, "planner_fallback_api_key", None) or cfg.writer_api_key,
        name="planner_fallback",
    )


def writer_client(cfg) -> ChatClient:
    return ChatClient(cfg.writer_base_url, cfg.writer_model, cfg.writer_api_key,
                      name="writer")


def writer_fallback_client(cfg) -> ChatClient:
    return ChatClient(
        getattr(cfg, "writer_fallback_base_url", None)
        or getattr(cfg, "planner_fallback_base_url", None)
        or getattr(cfg, "planner_base_url", None)
        or cfg.writer_base_url,
        getattr(cfg, "writer_fallback_model", None)
        or getattr(cfg, "planner_fallback_model", None)
        or getattr(cfg, "planner_model", None)
        or cfg.writer_model,
        getattr(cfg, "writer_fallback_api_key", None)
        or getattr(cfg, "planner_fallback_api_key", None)
        or getattr(cfg, "planner_api_key", None)
        or cfg.writer_api_key,
        name="writer_fallback",
    )
