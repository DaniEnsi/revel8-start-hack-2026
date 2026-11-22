"""
target_api.py — client for the revel8 Target API (research/02-api-contract.md).

- Bearer auth, JSON in/out, 120s client timeout (server allows 90s/request).
- Idempotency-Key per contact; the SAME key is reused across automatic retries
  so a retried send never double-spends a touch.
- Retries 429/502/503/504 with backoff; never retries 400/422.
- Stdlib only (urllib) — no third-party deps.
"""
from __future__ import annotations

import json
import time
import uuid
import urllib.request
import urllib.error
from typing import Optional

from .config import Config

RETRYABLE = {429, 502, 503, 504}
MAX_RETRIES = 4
# Every message/turn runs a model (server allows 90s/request); keep the client
# ceiling well above that so a slow-but-valid model call is never torn down.
TIMEOUT = 120.0

# Form field names are objective metadata; submitted values are not. Keep this
# classification at the HTTP boundary so live, resume, traces, and API callers
# all receive the same value-free event shape.
SECRET_FIELDS = frozenset({
    "password", "pin", "otp", "verification_code", "token", "api_key",
    "card_number", "iban",
})
BASIC_FIELDS = frozenset({
    "name", "email", "company", "job_title", "phone", "username",
})
INTERNAL_FIELDS = frozenset({"vpn_client", "approver", "internal_tool"})
FREE_TEXT_FIELDS = frozenset({
    "free_text", "notes", "internal_notes", "details", "additional_details",
    "additional_info", "additional_information", "comments", "description",
    "other", "context", "requirements",
})
_MISSING = object()


def _normalise_field_name(name) -> str:
    return str(name).strip().lower().replace("-", "_").replace(" ", "_")


def _is_entered(value) -> bool:
    """Return only a boolean; never copy a submitted value into metadata."""
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, (bytes, bytearray)):
        return bool(value.strip())
    if isinstance(value, (list, tuple, dict, set, frozenset)):
        return bool(value)
    # Numeric zero can be a real PIN/OTP; only None/blank/containers are empty.
    return True


def submission_metadata(event: dict) -> dict:
    """Derive non-sensitive, idempotent page.submitted classification metadata.

    With the updated API, ``values`` is authoritative (including blank values).
    With a legacy event that has no ``values``/metadata, filled ``fields`` retain
    their original meaning. Unknown field names fail closed as non-incidents;
    known internal and conventional free-text fields remain distinct from
    credentials.
    """
    fields = event.get("fields") or event.get("field_names") or []
    if not isinstance(fields, (list, tuple)):
        fields = []
    existing = event.get("submission")
    values = event.get("values", _MISSING)

    if isinstance(values, dict):
        source = "values"
        entered = [name for name, value in values.items() if _is_entered(value)]
    elif values is not _MISSING:
        # A malformed values shape must not fall back to trusting ``fields``.
        source = "values"
        entered = []
    elif isinstance(existing, dict) and isinstance(existing.get("entered_fields"), list):
        # Preserve values-authoritative emptiness on a second sanitisation pass.
        source = existing.get("source", "fields")
        if source not in ("values", "fields"):
            source = "fields"
        entered = existing["entered_fields"]
    else:
        source = "fields"
        entered = fields

    credentials, disclosures, basics, unknown = [], [], [], []
    entered_fields = []
    for raw_name in entered:
        name = _normalise_field_name(raw_name)
        if not name or name in entered_fields:
            continue
        entered_fields.append(name)
        if name in SECRET_FIELDS:
            credentials.append(name)
        elif name in BASIC_FIELDS:
            basics.append(name)
        elif (name in INTERNAL_FIELDS or name in FREE_TEXT_FIELDS
              or name.endswith(("_free_text", "_notes", "_details"))):
            disclosures.append(name)
        else:
            unknown.append(name)

    objective = "credentials" if credentials else "disclosure" if disclosures else "none"
    return {
        "objective": objective,
        "source": source,
        "entered_fields": entered_fields,
        "credential_fields": credentials,
        "disclosure_fields": disclosures,
        "basic_fields": basics,
        "unclassified_fields": unknown,
    }


def sanitize_target_payload(value):
    """Recursively remove every raw page.submitted value before returning data."""
    if isinstance(value, list):
        return [sanitize_target_payload(item) for item in value]
    if isinstance(value, tuple):
        return [sanitize_target_payload(item) for item in value]
    if not isinstance(value, dict):
        return value

    if value.get("type") == "page.submitted":
        metadata = submission_metadata(value)
        clean = {key: sanitize_target_payload(item)
                 for key, item in value.items() if key != "values"}
        clean["submission"] = metadata
        return clean
    return {key: sanitize_target_payload(item) for key, item in value.items()}


def _safe_error_body(body: str) -> str:
    """Do not let an error response become a side channel for submitted values."""
    text = str(body or "")
    try:
        parsed = json.loads(text)
    except (TypeError, ValueError, json.JSONDecodeError):
        if "page.submitted" in text or "values" in text:
            return "[non-JSON error body omitted: possible submission data]"
        return text
    return json.dumps(sanitize_target_payload(parsed), ensure_ascii=False)


class TargetAPIError(Exception):
    def __init__(self, status: int, body: str, method: str, path: str):
        self.status = status
        self.body = _safe_error_body(body)
        super().__init__(
            f"TargetAPI {method} {path} -> HTTP {status}: {self.body[:400]}")


def _ensure_dict(obj) -> dict:
    """Never let an unexpected response shape crash a caller that does `.get`."""
    return obj if isinstance(obj, dict) else {}


def _ensure_list(obj) -> list:
    """Coerce a list endpoint's body to a list even if the server wraps it."""
    if isinstance(obj, list):
        return obj
    if isinstance(obj, dict):
        for k in ("sessions", "scenarios", "channels", "items", "data", "results"):
            v = obj.get(k)
            if isinstance(v, list):
                return v
    return []


class TargetClient:
    def __init__(self, cfg: Config):
        self.base = cfg.revel8_api_base
        self.key = cfg.revel8_team_key

    # ------------------------------------------------------------------ core
    def _request(
        self,
        method: str,
        path: str,
        payload: Optional[dict] = None,
        idempotency_key: Optional[str] = None,
        raw_body: Optional[bytes] = None,
        raw_headers: Optional[dict] = None,
    ) -> dict:
        url = self.base + path
        headers = {"Authorization": f"Bearer {self.key}"}
        data = None
        if raw_body is not None:
            data = raw_body
            headers.update(raw_headers or {})
        elif payload is not None:
            data = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json"
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key

        last_err: Optional[Exception] = None
        for attempt in range(MAX_RETRIES + 1):
            req = urllib.request.Request(url, data=data, method=method)
            for k, v in headers.items():
                req.add_header(k, v)
            try:
                with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                    status = getattr(resp, "status", 200) or 200
                    text = resp.read().decode("utf-8", "replace")
                if not text.strip():
                    return {}
                try:
                    return sanitize_target_payload(json.loads(text))
                except (ValueError, json.JSONDecodeError):
                    # 2xx with an unparseable body: surface it as a handleable
                    # error instead of crashing the run with a raw JSONDecodeError.
                    raise TargetAPIError(
                        status, "non-JSON response body omitted", method, path)
            except urllib.error.HTTPError as e:
                body = ""
                try:
                    body = e.read().decode("utf-8", "replace")
                except Exception:
                    pass
                if e.code in RETRYABLE and attempt < MAX_RETRIES:
                    wait = min(2 ** attempt * 3, 30)
                    time.sleep(wait)
                    continue
                raise TargetAPIError(e.code, body, method, path)
            except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
                last_err = e
                if attempt < MAX_RETRIES:
                    time.sleep(min(2 ** attempt * 2, 20))
                    continue
                raise TargetAPIError(0, f"network error: {e}", method, path)
        raise TargetAPIError(0, f"network error: {last_err}", method, path)

    @staticmethod
    def new_idem_key(prefix: str) -> str:
        return f"{prefix}-{uuid.uuid4().hex[:24]}"

    # ------------------------------------------------------------- scenarios
    def list_scenarios(self) -> list:
        return _ensure_list(self._request("GET", "/scenarios"))

    def list_channels(self) -> list:
        return _ensure_list(self._request("GET", "/channels"))

    # -------------------------------------------------------------- sessions
    def create_session(self, scenario_id: str = "practice",
                       idem_key: Optional[str] = None) -> dict:
        """Create a session, optionally using a caller-durable idempotency key.

        Flow and scored-session manifests choose their key before the first
        request so a crash/retry cannot create a second session. Existing
        callers retain the generated-key behavior.
        """
        return _ensure_dict(self._request(
            "POST", "/sessions", {"scenario_id": scenario_id},
            idempotency_key=idem_key or self.new_idem_key("sess"),
        ))

    def get_session(self, sid: str) -> dict:
        return _ensure_dict(self._request("GET", f"/sessions/{sid}"))

    def list_sessions(self) -> list:
        return _ensure_list(self._request("GET", "/sessions"))

    def get_events(self, sid: str) -> dict:
        return _ensure_dict(self._request("GET", f"/sessions/{sid}/events"))

    def end_session(self, sid: str) -> dict:
        return _ensure_dict(self._request("POST", f"/sessions/{sid}/end", {}))

    # -------------------------------------------------------------- messages
    def send_message(self, sid: str, message: dict, idem_key: Optional[str] = None,
                     sent_at: Optional[str] = None) -> dict:
        """message: {to, channel, from:{name,address}, subject, body, attachments?}"""
        payload = dict(message)
        if sent_at is not None:
            payload["sent_at"] = sent_at
        return _ensure_dict(self._request(
            "POST", f"/sessions/{sid}/messages", payload,
            idempotency_key=idem_key or self.new_idem_key("msg"),
        ))

    # ----------------------------------------------------------------- pages
    def register_page(self, sid: str, url: str, title: str, html: str,
                      fields: list, text: Optional[str] = None,
                      images: Optional[list] = None) -> dict:
        payload = {"url": url, "title": title, "fields": fields}
        if html:
            payload["html"] = html
        else:
            payload["text"] = text or title
            if images:
                payload["images"] = images
        return _ensure_dict(self._request("POST", f"/sessions/{sid}/pages", payload))

    # --------------------------------------------------------- conversations
    def start_conversation(self, sid: str, to: str, channel: str, from_: dict,
                           sent_at: Optional[str] = None,
                           idem_key: Optional[str] = None) -> dict:
        payload = {"to": to, "channel": channel, "from": from_}
        if sent_at is not None:
            payload["sent_at"] = sent_at
        return _ensure_dict(self._request(
            "POST", f"/sessions/{sid}/conversations", payload,
            idempotency_key=idem_key or self.new_idem_key("conv"),
        ))

    def conversation_turn(self, cid: str, say: str, idem_key: Optional[str] = None,
                          sent_at: Optional[str] = None) -> dict:
        payload = {"say": say}
        if sent_at is not None:
            payload["sent_at"] = sent_at
        return _ensure_dict(self._request(
            "POST", f"/conversations/{cid}/turns", payload,
            idempotency_key=idem_key or self.new_idem_key("turn"),
        ))

    def end_conversation(self, cid: str) -> dict:
        return _ensure_dict(self._request("POST", f"/conversations/{cid}/end", {}))

    # ---------------------------------------------------------------- assets
    def upload_asset(self, data: bytes, filename: str, content_type: str) -> dict:
        """Multipart upload, field name 'file' (02)."""
        boundary = "----revel8agent" + uuid.uuid4().hex[:16]
        parts = []
        parts.append(f"--{boundary}\r\n".encode())
        parts.append(
            f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
            f"Content-Type: {content_type}\r\n\r\n".encode()
        )
        parts.append(data)
        parts.append(f"\r\n--{boundary}--\r\n".encode())
        body = b"".join(parts)
        return _ensure_dict(self._request(
            "POST", "/assets",
            raw_body=body,
            raw_headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
            idempotency_key=self.new_idem_key("asset"),
        ))
