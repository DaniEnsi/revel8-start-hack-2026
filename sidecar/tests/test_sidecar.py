"""Deterministic sidecar boundary tests using only synthetic local fixtures."""
from __future__ import annotations

import copy
import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

SIDECAR_DIR = Path(__file__).resolve().parents[1]
if str(SIDECAR_DIR) not in sys.path:
    sys.path.insert(0, str(SIDECAR_DIR))

import app as sidecar_app
from fastapi import FastAPI, HTTPException, Response, WebSocket
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient
from sanitization import SanitizeJSONMiddleware, sanitize_payload

FIXTURES = Path(__file__).parent / "fixtures"


def read_jsonl(path: Path):
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]


def raw_sentinels(value):
    found = set()
    if isinstance(value, dict):
        for item in value.values():
            found.update(raw_sentinels(item))
    elif isinstance(value, list):
        for item in value:
            found.update(raw_sentinels(item))
    elif isinstance(value, str) and "raw-" in value:
        found.add(value)
    return found


class ValueFreeAssertions:
    def assertValueFree(self, payload, sentinels):
        serialized = json.dumps(payload, ensure_ascii=False)
        for sentinel in sentinels:
            self.assertNotIn(sentinel, serialized)


class SidecarFixtureTests(ValueFreeAssertions, unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.historical_bytes = (FIXTURES / "legacy-secrets.jsonl").read_bytes()
        cls.historical_records = read_jsonl(FIXTURES / "legacy-secrets.jsonl")
        cls.live_bytes = (FIXTURES / "live-secret.jsonl").read_bytes()
        cls.live_record = read_jsonl(FIXTURES / "live-secret.jsonl")[0]
        cls.playbook = json.loads((FIXTURES / "secret-playbook.json").read_text(encoding="utf-8"))
        cls.historical_sentinels = raw_sentinels(cls.historical_records)
        cls.live_sentinels = raw_sentinels(cls.live_record)
        cls.playbook_sentinels = raw_sentinels(cls.playbook)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.traces_dir = Path(self.temp.name) / "traces"
        self.traces_dir.mkdir()
        self.trace_path = self.traces_dir / "legacy.jsonl"
        self.trace_path.write_bytes(self.historical_bytes)
        self.playbook_path = Path(self.temp.name) / "playbook.json"
        shutil.copyfile(FIXTURES / "secret-playbook.json", self.playbook_path)

        self.old_traces_dir = sidecar_app.TRACES_DIR
        self.old_playbook_path = sidecar_app.PLAYBOOK_PATH
        self.old_poll_interval = sidecar_app.POLL_INTERVAL
        self.old_runs = dict(sidecar_app._runs)
        self.old_pending = list(sidecar_app._pending)
        sidecar_app.TRACES_DIR = self.traces_dir
        sidecar_app.PLAYBOOK_PATH = self.playbook_path
        sidecar_app.POLL_INTERVAL = 0.01
        sidecar_app._runs.clear()
        sidecar_app._pending.clear()

    def tearDown(self):
        sidecar_app.TRACES_DIR = self.old_traces_dir
        sidecar_app.PLAYBOOK_PATH = self.old_playbook_path
        sidecar_app.POLL_INTERVAL = self.old_poll_interval
        sidecar_app._runs.clear()
        sidecar_app._runs.update(self.old_runs)
        sidecar_app._pending[:] = self.old_pending
        self.temp.cleanup()

    def assertHistoricalMetadata(self, records):
        touch = records[1]
        standard, legacy, descriptors, alias = touch["events"]
        self.assertNotIn("values", standard)
        self.assertEqual(standard["fields"], ["email", "password"])
        self.assertEqual(standard["submission"]["objective"], "credentials")
        self.assertEqual(standard["submission"]["credential_fields"], ["password"])
        self.assertEqual(standard["submission"]["basic_fields"], ["email"])

        self.assertEqual(legacy["fields"], ["email", "iban", "internal_notes"])
        self.assertEqual(legacy["submission"]["entered_fields"], ["email", "iban", "internal_notes"])
        self.assertEqual(legacy["submission"]["credential_fields"], ["iban"])
        self.assertEqual(legacy["submission"]["disclosure_fields"], ["internal_notes"])

        self.assertEqual(descriptors["fields"], ["email", "otp"])
        self.assertEqual(descriptors["submission"]["credential_fields"], ["otp"])
        self.assertEqual(alias["submission"]["credential_fields"], ["token"])

        self.assertEqual(touch["fields"], [{"name": "custom_question"}, {"name": "email"}])
        self.assertEqual(touch["incident"]["objective"], "credentials")
        self.assertEqual(touch["incident"]["via"], "page.submitted")
        self.assertEqual(touch["incident"]["fields"], ["email", "password"])
        self.assertEqual(touch["incident"]["debug"]["safe_note"], "preserved")
        self.assertEqual(touch["classification"]["credential_fields"], ["password"])
        self.assertEqual(touch["classification"]["unclassified_fields"], ["custom_question"])
        self.assertEqual(touch["name_value_metrics"], {"name": "final_suspicion", "value": 0.25})
        self.assertEqual(records[0]["config"]["WRITER_BASE_URL"], "http://writer.example.invalid")
        self.assertEqual(records[2]["incident"]["fields"], ["email", "password"])

    def test_sanitizer_is_recursive_idempotent_and_does_not_mutate_input(self):
        original = copy.deepcopy(self.historical_records)
        once = sanitize_payload(original)
        twice = sanitize_payload(once)
        self.assertEqual(original, self.historical_records)
        self.assertEqual(twice, once)
        self.assertValueFree(once, self.historical_sentinels)
        self.assertHistoricalMetadata(once)

    def test_historical_read_records_is_value_free_and_read_only(self):
        records = sidecar_app.read_records(self.trace_path)
        self.assertValueFree(records, self.historical_sentinels)
        self.assertHistoricalMetadata(records)
        self.assertEqual(self.trace_path.read_bytes(), self.historical_bytes)

    def test_replay_rest_response_is_value_free_and_read_only(self):
        with TestClient(sidecar_app.app) as client:
            response = client.get("/api/runs/legacy")
        self.assertEqual(response.status_code, 200)
        self.assertValueFree(response.json(), self.historical_sentinels)
        self.assertHistoricalMetadata(response.json()["records"])
        self.assertEqual(self.trace_path.read_bytes(), self.historical_bytes)

    def test_run_list_rest_response_preserves_safe_derived_metadata(self):
        with TestClient(sidecar_app.app) as client:
            response = client.get("/api/runs")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertValueFree(payload, self.historical_sentinels)
        self.assertEqual(len(payload["runs"]), 1)
        meta = payload["runs"][0]["meta"]
        self.assertEqual(meta["target"], "julius")
        self.assertEqual(meta["scenario"], "practice")
        self.assertEqual(meta["objective"], "credentials")
        self.assertEqual(meta["arms"]["f2"], "link_free")
        self.assertNotIn("api_key", meta["arms"]["nested"])
        self.assertEqual(meta["outcome"], "incident")
        self.assertEqual(meta["channels"], ["email"])
        self.assertEqual(meta["incidentTouch"], 2)
        self.assertEqual(meta["finalSuspicion"], 0.25)
        self.assertEqual(self.trace_path.read_bytes(), self.historical_bytes)

    def test_playbook_rest_response_is_value_free_and_preserves_field_names(self):
        with TestClient(sidecar_app.app) as client:
            response = client.get("/api/playbook")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertValueFree(payload, self.playbook_sentinels)
        entry = payload["entries"][0]
        self.assertEqual(entry["fields"], ["email", "password"])
        self.assertEqual(entry["classification"]["credential_fields"], ["password"])
        self.assertEqual(entry["debug"]["safe"], "preserved")
        self.assertNotIn("values", entry)
        self.assertEqual(payload["name_value_metric"], {"name": "conversion", "value": 0.5})

    def test_websocket_snapshot_is_value_free_and_read_only(self):
        with TestClient(sidecar_app.app) as client:
            with client.websocket_connect("/ws/runs/legacy") as websocket:
                frame = websocket.receive_json()
        self.assertEqual(frame["type"], "snapshot")
        self.assertValueFree(frame, self.historical_sentinels)
        self.assertHistoricalMetadata(frame["records"])
        self.assertEqual(self.trace_path.read_bytes(), self.historical_bytes)

    def test_websocket_live_tail_is_value_free_without_rewriting_history(self):
        with TestClient(sidecar_app.app) as client:
            with client.websocket_connect("/ws/runs/legacy") as websocket:
                snapshot = websocket.receive_json()
                self.assertEqual(snapshot["type"], "snapshot")
                with self.trace_path.open("ab") as handle:
                    handle.write(self.live_bytes)
                frame = websocket.receive_json()
        self.assertEqual(frame["type"], "record")
        self.assertValueFree(frame, self.live_sentinels)
        event = frame["record"]["events"][0]
        self.assertEqual(event["fields"], ["email", "card_number"])
        self.assertEqual(event["submission"]["credential_fields"], ["card_number"])
        self.assertEqual(event["submission"]["basic_fields"], ["email"])
        self.assertEqual(self.trace_path.read_bytes(), self.historical_bytes + self.live_bytes)


class ResponseMiddlewareTests(ValueFreeAssertions, unittest.TestCase):
    def setUp(self):
        self.payload = read_jsonl(FIXTURES / "legacy-secrets.jsonl")[1]
        self.sentinels = raw_sentinels(self.payload)
        boundary = FastAPI()
        boundary.add_middleware(SanitizeJSONMiddleware)

        @boundary.get("/fixture")
        def fixture():
            return JSONResponse(self.payload)

        @boundary.get("/error")
        def error():
            raise HTTPException(status_code=422, detail=self.payload)

        @boundary.get("/invalid")
        def invalid():
            return Response(
                content='{"values":{"password":"raw-invalid-json-sentinel"}',
                media_type="application/json",
            )

        @boundary.websocket("/ws")
        async def websocket(websocket: WebSocket):
            await websocket.accept()
            await websocket.send_json(self.payload)
            await websocket.close()

        self.client = TestClient(boundary)

    def tearDown(self):
        self.client.close()

    def test_success_and_error_rest_responses_cross_the_same_boundary(self):
        for path, status in (("/fixture", 200), ("/error", 422)):
            with self.subTest(path=path):
                response = self.client.get(path)
                self.assertEqual(response.status_code, status)
                self.assertValueFree(response.json(), self.sentinels)
                self.assertEqual(int(response.headers["content-length"]), len(response.content))

    def test_malformed_json_response_fails_closed(self):
        response = self.client.get("/invalid")
        self.assertEqual(response.status_code, 500)
        self.assertNotIn("raw-invalid-json-sentinel", response.text)
        self.assertEqual(response.json(), {"detail": "Invalid JSON response omitted"})

    def test_websocket_frames_cross_the_boundary_even_without_route_helper(self):
        with self.client.websocket_connect("/ws") as websocket:
            frame = websocket.receive_json()
        self.assertValueFree(frame, self.sentinels)
        self.assertEqual(frame["events"][0]["submission"]["credential_fields"], ["password"])


class CorsAndStartupTests(unittest.TestCase):
    def test_default_cors_origins_are_exact_and_loopback_only(self):
        self.assertEqual(
            sidecar_app._cors_origins(""),
            ["http://localhost:3000", "http://127.0.0.1:3000"],
        )
        for origin in sidecar_app.DEFAULT_CORS_ORIGINS:
            with self.subTest(origin=origin):
                with TestClient(sidecar_app.app) as client:
                    response = client.options(
                        "/api/health",
                        headers={"Origin": origin, "Access-Control-Request-Method": "GET"},
                    )
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.headers["access-control-allow-origin"], origin)

    def test_unlisted_and_wildcard_origins_are_not_allowed(self):
        with TestClient(sidecar_app.app) as client:
            simple = client.get("/api/health", headers={"Origin": "http://localhost:3001"})
            preflight = client.options(
                "/api/health",
                headers={"Origin": "*", "Access-Control-Request-Method": "GET"},
            )
        self.assertNotIn("access-control-allow-origin", simple.headers)
        self.assertEqual(preflight.status_code, 400)
        self.assertNotIn("access-control-allow-origin", preflight.headers)

    def test_cors_origins_are_env_configurable_but_never_wildcard_or_remote(self):
        self.assertEqual(
            sidecar_app._cors_origins(
                "http://localhost:4173, http://127.0.0.1:4173/, http://localhost:4173"
            ),
            ["http://localhost:4173", "http://127.0.0.1:4173"],
        )
        for invalid in ("*", "https://dashboard.example.com", "http://localhost:3000/path"):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                sidecar_app._cors_origins(invalid)

    def test_direct_startup_defaults_to_loopback_and_compose_host_override_works(self):
        with mock.patch.dict(os.environ, {}, clear=True), mock.patch("uvicorn.run") as run:
            sidecar_app.main()
        self.assertEqual(run.call_args.kwargs["host"], "127.0.0.1")
        self.assertEqual(run.call_args.kwargs["port"], 8787)

        with mock.patch.dict(os.environ, {"HOST": ""}, clear=True), mock.patch("uvicorn.run") as run:
            sidecar_app.main()
        self.assertEqual(run.call_args.kwargs["host"], "127.0.0.1")

        env = {"HOST": "0.0.0.0", "PORT": "9000"}
        with mock.patch.dict(os.environ, env, clear=True), mock.patch("uvicorn.run") as run:
            sidecar_app.main()
        self.assertEqual(run.call_args.kwargs["host"], "0.0.0.0")
        self.assertEqual(run.call_args.kwargs["port"], 9000)


if __name__ == "__main__":
    unittest.main()
