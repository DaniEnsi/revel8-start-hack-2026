"""Defense-in-depth sanitization for data leaving the dashboard sidecar."""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path
from typing import Any, Optional

# Reuse the agent's value-free submission contract without importing its runner.
_PROJECT_ROOT = Path(
    os.environ.get("REVEL8_PROJECT_ROOT", Path(__file__).resolve().parent.parent)
).resolve()
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

from agent.target_api import SECRET_FIELDS, sanitize_target_payload


_ALIAS_VALUE_KEYS = (
    "legacy_values", "submitted_values", "submission_values", "form_values",
)
_RAW_VALUE_KEYS = frozenset({"values", *_ALIAS_VALUE_KEYS})
_FIELD_KEYS = frozenset({"fields", "field_names"})
_NAME_KEYS = ("name", "field", "field_name", "key")
_ENTRY_VALUE_KEYS = ("value", "field_value", "submitted_value")
_KNOWN_FORM_FIELDS = frozenset(SECRET_FIELDS) | frozenset({
    "name", "email", "company", "job_title", "phone", "username",
    "vpn_client", "approver", "internal_tool", "free_text", "notes",
    "internal_notes", "details", "additional_details", "additional_info",
    "additional_information", "comments", "description", "other", "context",
    "requirements",
})
_SECRET_KEYS = frozenset(SECRET_FIELDS) | frozenset({
    "credential", "credentials", "secret", "secret_key", "client_secret",
    "passwd", "passphrase", "passcode", "apikey", "authorization",
    "proxy_authorization", "cookie", "set_cookie", "cvv", "cvc",
    "access_token", "refresh_token", "session_token", "auth_token",
    "bearer_token", "private_key", "team_key", "idempotency_key",
})
_SECRET_SUFFIXES = (
    "_password", "_passwd", "_passphrase", "_pin", "_otp", "_token",
    "_api_key", "_secret", "_private_key", "_team_key", "_card_number",
    "_iban", "_cvv",
)


def _normalise_key(value: Any) -> str:
    text = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "_", str(value))
    return text.strip().lower().replace("-", "_").replace(" ", "_")


def _is_secret_key(key: Any) -> bool:
    normalised = _normalise_key(key)
    return normalised in _SECRET_KEYS or normalised.endswith(_SECRET_SUFFIXES)


def _entry_name(entry: Any, allow_string: bool = False) -> Optional[str]:
    if allow_string and isinstance(entry, str) and entry.strip():
        return entry
    if not isinstance(entry, dict):
        return None
    for key in _NAME_KEYS:
        name = entry.get(key)
        if isinstance(name, (str, int)) and str(name).strip():
            return str(name)
    return None


def _normalise_fields(fields: Any) -> tuple[list[str], Optional[dict[str, Any]]]:
    """Keep field names while converting legacy descriptor maps for the agent."""
    if isinstance(fields, dict):
        return [str(name) for name in fields], dict(fields)
    if isinstance(fields, str):
        return [fields], None
    if not isinstance(fields, (list, tuple)):
        return [], None

    names = []
    values = {}
    has_explicit_value = False
    for entry in fields:
        name = _entry_name(entry, allow_string=True)
        if name is None:
            continue
        names.append(name)
        if isinstance(entry, dict):
            for value_key in _ENTRY_VALUE_KEYS:
                if value_key in entry:
                    values[name] = entry[value_key]
                    has_explicit_value = True
                    break
    return names, values if has_explicit_value else None


def _normalise_value_entries(values: Any) -> tuple[list[str], Any]:
    """Convert legacy [{name, value}] entries to the agent's values map."""
    if not isinstance(values, (list, tuple)):
        return [], values
    names = []
    converted = {}
    for entry in values:
        name = _entry_name(entry)
        if name is None:
            # Leave malformed input value-free; the agent fails closed on it.
            return [], values
        names.append(name)
        for value_key in _ENTRY_VALUE_KEYS:
            if isinstance(entry, dict) and value_key in entry:
                converted[name] = entry[value_key]
                break
        else:
            # Legacy filled-field arrays contained only entered fields.
            converted[name] = True
    return names, converted


def _is_submission(value: dict[str, Any]) -> bool:
    return any(value.get(key) == "page.submitted" for key in ("type", "event_type", "kind"))


def _prepare_submissions(value: Any) -> Any:
    """Normalize legacy shapes without mutating parsed historical records."""
    if isinstance(value, (list, tuple)):
        return [_prepare_submissions(item) for item in value]
    if not isinstance(value, dict):
        return value

    prepared = {key: _prepare_submissions(item) for key, item in value.items()}
    if not _is_submission(prepared):
        return prepared

    event = dict(prepared)
    event["type"] = "page.submitted"

    for key in _ALIAS_VALUE_KEYS:
        if key in event:
            if "values" not in event:
                event["values"] = event[key]
            event.pop(key, None)

    existing_submission = event.get("submission")
    if "values" not in event and isinstance(existing_submission, dict):
        if "values" in existing_submission:
            event["values"] = existing_submission["values"]

    value_names = []
    if "values" in event:
        value_names, event["values"] = _normalise_value_entries(event["values"])

    for key in _FIELD_KEYS:
        if key not in event:
            continue
        names, descriptor_values = _normalise_fields(event[key])
        event[key] = names
        if descriptor_values is not None and "values" not in event:
            event["values"] = descriptor_values

    if value_names and not any(event.get(key) for key in _FIELD_KEYS):
        event["fields"] = value_names
    return event


def _is_field_value_entry(value: dict[str, Any], form_context: bool) -> bool:
    name = _entry_name(value)
    if name is None:
        return False
    return form_context or _normalise_key(name) in _KNOWN_FORM_FIELDS


def _defensive_sanitize(value: Any, form_context: bool = False) -> Any:
    """Fail closed on secret keys and legacy forms missed by the agent contract."""
    if isinstance(value, (list, tuple)):
        return [_defensive_sanitize(item, form_context) for item in value]
    if not isinstance(value, dict):
        return value

    context = form_context or _is_submission(value)
    clean = {}
    for key, item in value.items():
        normalised = _normalise_key(key)
        if _is_secret_key(key) or normalised in _RAW_VALUE_KEYS:
            continue
        if normalised in _ENTRY_VALUE_KEYS and _is_field_value_entry(value, context):
            continue
        clean[key] = _defensive_sanitize(item, context or normalised in _FIELD_KEYS)
    return clean


def sanitize_payload(value: Any) -> Any:
    """Return a recursively value-free copy suitable for an outbound payload."""
    agent_clean = sanitize_target_payload(_prepare_submissions(value))
    return _defensive_sanitize(agent_clean)


def _json_bytes(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


class SanitizeJSONMiddleware:
    """Sanitize every JSON HTTP response and WebSocket frame at the ASGI edge."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http":
            await self._http(scope, receive, send)
        elif scope["type"] == "websocket":
            await self._websocket(scope, receive, send)
        else:
            await self.app(scope, receive, send)

    async def _http(self, scope, receive, send):
        messages = []

        async def capture(message):
            messages.append(message)

        await self.app(scope, receive, capture)
        start = next((item for item in messages if item["type"] == "http.response.start"), None)
        if start is None:
            for message in messages:
                await send(message)
            return

        content_type = ""
        for key, value in start.get("headers", []):
            if key.lower() == b"content-type":
                content_type = value.decode("latin-1").split(";", 1)[0].strip().lower()
                break
        if content_type != "application/json" and not content_type.endswith("+json"):
            for message in messages:
                await send(message)
            return

        raw_body = b"".join(
            message.get("body", b"") for message in messages
            if message["type"] == "http.response.body"
        )
        if not raw_body:
            for message in messages:
                await send(message)
            return

        try:
            clean_body = _json_bytes(sanitize_payload(json.loads(raw_body)))
            status = start["status"]
        except (UnicodeDecodeError, json.JSONDecodeError, ValueError, TypeError):
            # Never pass through a malformed JSON body that could contain raw values.
            clean_body = b'{"detail":"Invalid JSON response omitted"}'
            status = 500

        headers = [
            (key, value) for key, value in start.get("headers", [])
            if key.lower() != b"content-length"
        ]
        headers.append((b"content-length", str(len(clean_body)).encode("ascii")))
        await send({**start, "status": status, "headers": headers})
        await send({"type": "http.response.body", "body": clean_body})

    async def _websocket(self, scope, receive, send):
        async def sanitized_send(message):
            if message["type"] != "websocket.send":
                await send(message)
                return

            mode = "text" if message.get("text") is not None else "bytes"
            raw = message.get(mode)
            if raw is None:
                await send(message)
                return
            try:
                parsed = json.loads(raw)
            except (UnicodeDecodeError, json.JSONDecodeError, ValueError, TypeError):
                parsed = {"type": "error", "detail": "Non-JSON WebSocket frame omitted"}

            encoded = _json_bytes(sanitize_payload(parsed))
            clean = dict(message)
            clean[mode] = encoded if mode == "bytes" else encoded.decode("utf-8")
            await send(clean)

        await self.app(scope, receive, sanitized_send)
