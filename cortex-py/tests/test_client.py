"""Wire contract tests for the Python SDK against a stub core (stdlib only)."""

from __future__ import annotations

import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

from cortex_py import Cortex, CortexError

SEEN = []
MODE = {"value": "ok"}


class Stub(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):  # silence
        pass

    def _reply(self, status, payload):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _handle(self, method, body=None):
        # urllib sends `X-cortex-key`; header names are case-insensitive in HTTP,
        # so normalise here rather than teaching the client to guess casing.
        headers = {str(key).lower(): value for key, value in self.headers.items()}
        SEEN.append({"path": self.path, "method": method, "headers": headers, "body": body})
        if MODE["value"] == "unauthorized":
            return self._reply(401, {"error": {"code": "unauthorized", "message": "invalid token"}})
        if self.path.startswith("/v1/ingest"):
            return self._reply(
                200,
                {
                    "accepted": True,
                    "job_id": "job_1",
                    "result": {
                        "triplets_extracted": 2,
                        "triplets_rejected": 0,
                        "nodes_upserted": 2,
                        "nodes_new": 1,
                        "edges_upserted": 1,
                        "edges_new": 1,
                        "extractor": "heuristics",
                        "warnings": [],
                        "owner_uri": "cortex://me",
                    },
                },
            )
        if self.path.startswith("/v1/recall"):
            return self._reply(
                200,
                {
                    "briefing": "[memory] use pnpm",
                    "token_budget": 400,
                    "tokens_used": 4,
                    "memories_found": 1,
                    "truncated": False,
                    "scanned": 3,
                    "owner_uri": "cortex://me",
                    "nodes": [],
                    "edges": [],
                },
            )
        if self.path.startswith("/v1/jobs"):
            return self._reply(200, {"job_id": "job_1", "state": "done", "result": {"triplets_extracted": 1}})
        if self.path.startswith("/v1/memories/"):
            return self._reply(200, {"deleted": True, "node_id": "abc def"})
        if self.path.startswith("/health"):
            return self._reply(
                200,
                {
                    "status": "ok",
                    "backend": "file",
                    "version": "test",
                    "decay_policy": "soft",
                    "authenticated": True,
                    "services": {"graph": True, "extraction": False, "cloud_sync": False},
                    "counts": {"nodes": 2, "edges": 1},
                },
            )
        return self._reply(200, {"ok": True, "path": self.path})

    def do_GET(self):
        self._handle("GET")

    def do_POST(self):
        length = int(self.headers.get("content-length") or 0)
        raw = self.rfile.read(length).decode() if length else ""
        self._handle("POST", json.loads(raw) if raw else None)

    def do_DELETE(self):
        self._handle("DELETE")


class SdkTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = HTTPServer(("127.0.0.1", 0), Stub)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = f"http://127.0.0.1:{cls.server.server_address[1]}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def setUp(self):
        SEEN.clear()
        MODE["value"] = "ok"
        self.client = Cortex(api_key="k123", base_url=self.url, owner="cortex://me")

    def test_remember_posts_core_ingest_keys(self):
        result = self.client.remember("always use pnpm in CI", source="test", impact=8)
        entry = SEEN[0]
        self.assertEqual(entry["method"], "POST")
        self.assertEqual(entry["path"], "/v1/ingest")
        self.assertEqual(
            sorted(entry["body"].keys()),
            ["impact", "owner", "prompt", "source", "wait"],
        )
        self.assertEqual(entry["body"]["owner"], "cortex://me")
        self.assertEqual(entry["body"]["impact"], 8)
        self.assertEqual(entry["headers"].get("x-cortex-key"), "k123")
        self.assertEqual(entry["headers"].get("authorization"), "Bearer k123")
        self.assertEqual(result["result"]["triplets_extracted"], 2)
        self.assertEqual(entry["headers"].get("content-type"), "application/json")

    def test_remember_report_is_flattened(self):
        report = self.client.remember_report("ship from main behind a flag")
        self.assertTrue(report.stored)
        self.assertEqual(report.extractor, "heuristics")
        self.assertEqual(report.owner_uri, "cortex://me")

    def test_empty_remember_raises_locally(self):
        with self.assertRaises(ValueError):
            self.client.remember("   ")

    def test_recall_returns_typed_result(self):
        result = self.client.recall("which package manager?", token_budget=400, explain=True)
        self.assertEqual(sorted(SEEN[0]["body"].keys()), ["explain", "include_mesh", "owner", "prompt", "token_budget"])
        self.assertEqual(SEEN[0]["body"]["include_mesh"], False)
        self.assertTrue(result)
        self.assertEqual(str(result), "[memory] use pnpm")
        self.assertEqual(result.memories_found, 1)
        self.assertFalse(result.truncated)

    def test_resolve_graph_query(self):
        self.client.resolve_graph("cortex://team/platform", include_mesh=True, token_budget=600)
        self.assertIn("uri=cortex%3A%2F%2Fteam%2Fplatform", SEEN[0]["path"])
        self.assertIn("include_mesh=true", SEEN[0]["path"])
        self.assertIn("token_budget=600", SEEN[0]["path"])

    def test_forget_encodes_id_and_uses_delete(self):
        outcome = self.client.forget("abc def")
        self.assertEqual(SEEN[0]["method"], "DELETE")
        self.assertIn("abc%20def", SEEN[0]["path"])
        self.assertTrue(outcome["deleted"])

    def test_health_reports_flags_honestly(self):
        health = self.client.health()
        self.assertTrue(health.reachable)
        self.assertFalse(health.extraction_enabled)
        self.assertFalse(health.cloud_sync)

    def test_401_becomes_actionable_error(self):
        MODE["value"] = "unauthorized"
        with self.assertRaises(CortexError) as ctx:
            self.client.stats()
        self.assertEqual(ctx.exception.status, 401)
        self.assertEqual(ctx.exception.code, "unauthorized")
        self.assertIn("CORTEX_API_KEY", ctx.exception.hint or "")
        self.assertIn("invalid token", str(ctx.exception))

    def test_unreachable_core_is_a_cortex_error(self):
        dead = Cortex(base_url="http://127.0.0.1:1", timeout=2)
        with self.assertRaises(CortexError) as ctx:
            dead.health()
        self.assertEqual(ctx.exception.code, "network")
        self.assertIn("cargo run", ctx.exception.hint or "")

    def test_await_job_returns_terminal_state(self):
        job = self.client.await_job("job_1", timeout=5)
        self.assertEqual(job["state"], "done")


if __name__ == "__main__":
    unittest.main()
