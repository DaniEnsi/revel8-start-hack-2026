import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
	importHistoricalTraces,
	parseJsonlText,
	type TraceWatcher,
	watchTraceSession,
} from "./server-trace-sync";

async function body(request: IncomingMessage): Promise<any> {
	let text = "";
	for await (const chunk of request) text += chunk;
	return JSON.parse(text);
}

const sleep = (milliseconds: number) =>
	new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitFor(
	predicate: () => boolean,
	timeout = 5_000,
): Promise<void> {
	const deadline = Date.now() + timeout;
	while (!predicate()) {
		if (Date.now() > deadline)
			throw new Error("timed out waiting for trace ingest");
		await sleep(25);
	}
}

test("historical JSONL imports batch, redact, and repeat without new writes", async (t) => {
	const temporary = mkdtempSync(path.join(tmpdir(), "revel8-jsonl-import-"));
	const traces = path.join(temporary, "agent", "traces");
	mkdirSync(traces, { recursive: true });
	writeFileSync(path.join(temporary, "agent", "run.py"), "# test root\n");
	const records = Array.from({ length: 205 }, (_, index) => ({
		kind: index === 0 ? "session_start" : "touch",
		touch_idx: index,
		events: [
			{
				type: "page.submitted",
				outcome: "recorded",
				fields: { email: "person@example.test" },
				values: { email: "person@example.test", password: "value-free-canary" },
			},
		],
	}));
	writeFileSync(
		path.join(traces, "large-history.jsonl"),
		`${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
	);
	const requests: any[] = [];
	const seen = new Set<string>();
	const server = createServer(async (request, response) => {
		if (request.url !== "/revel8/ingest" || request.method !== "POST") {
			response.writeHead(404).end();
			return;
		}
		const input = await body(request);
		requests.push({
			input,
			authorization: request.headers["x-revel8-ingest-key"],
		});
		let inserted = 0;
		let unchanged = 0;
		for (const record of input.records) {
			const key = `${input.sessionId}:${record.ordinal}`;
			if (seen.has(key)) unchanged += 1;
			else {
				seen.add(key);
				inserted += 1;
			}
		}
		response.writeHead(200, { "content-type": "application/json" });
		response.end(
			JSON.stringify({ inserted, unchanged, updated: inserted ? 1 : 0 }),
		);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("no test port");
	const previous = {
		REVEL8_PROJECT_ROOT: process.env.REVEL8_PROJECT_ROOT,
		REVEL8_INGEST_SECRET: process.env.REVEL8_INGEST_SECRET,
		CONVEX_SITE_URL: process.env.CONVEX_SITE_URL,
	};
	process.env.REVEL8_PROJECT_ROOT = temporary;
	process.env.REVEL8_INGEST_SECRET =
		"loopback-ingest-secret-at-least-32-characters";
	process.env.CONVEX_SITE_URL = `http://127.0.0.1:${address.port}`;
	let watcher: TraceWatcher | null = null;
	t.after(async () => {
		watcher?.stop();
		for (const key of Object.keys(previous) as Array<keyof typeof previous>) {
			const value = previous[key];
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		await new Promise<void>((resolve, reject) =>
			server.close((error) => (error ? reject(error) : resolve())),
		);
		rmSync(temporary, { recursive: true, force: true });
	});

	assert.deepEqual(await importHistoricalTraces({}), {
		sessions: 1,
		inserted: 205,
		unchanged: 0,
		errors: [],
	});
	assert.deepEqual(
		requests.map((request) => request.input.records.length),
		[200, 5],
	);
	assert.equal(
		requests.every(
			(request) => request.authorization === process.env.REVEL8_INGEST_SECRET,
		),
		true,
	);
	assert.equal(JSON.stringify(requests).includes("value-free-canary"), false);
	assert.equal(JSON.stringify(requests).includes("person@example.test"), false);
	assert.equal(JSON.stringify(requests).includes("page.submitted"), true);

	assert.deepEqual(await importHistoricalTraces({}), {
		sessions: 1,
		inserted: 0,
		unchanged: 205,
		errors: [],
	});
	assert.deepEqual(
		requests.map((request) => request.input.records.length),
		[200, 5, 200, 5],
	);

	const livePath = path.join(traces, "live-session.jsonl");
	writeFileSync(
		livePath,
		`${JSON.stringify({ kind: "session_start", target_id: "tom" })}\n`,
	);
	const liveStart = requests.length;
	watcher = watchTraceSession("live-session", {}, { status: "running" });
	await waitFor(() => requests.length > liveStart);
	writeFileSync(
		livePath,
		`${JSON.stringify({ kind: "session_start", target_id: "tom" })}\n${JSON.stringify({ kind: "touch", touch_idx: 1, reaction: "replied" })}\n`,
	);
	await waitFor(() =>
		requests.some(
			(request) =>
				request.input.sessionId === "live-session" &&
				request.input.records.some((record: any) => record.ordinal === 1),
		),
	);
	await watcher.finish("completed");
	watcher = null;
	const liveRequests = requests.filter(
		(request) => request.input.sessionId === "live-session",
	);
	assert.equal(liveRequests.at(-1)?.input.status, "completed");
	assert.equal(
		liveRequests.some((request) =>
			request.input.records.some((record: any) => record.ordinal === 1),
		),
		true,
	);
});

test("JSONL parsing ignores only a trailing partial record and never leaks its contents", () => {
	assert.deepEqual(parseJsonlText('{"kind":"session_start"}\n{"kind":'), {
		records: [{ kind: "session_start" }],
		ignoredPartialLine: true,
	});
	assert.throws(
		() =>
			parseJsonlText('{"secret":"do-not-leak"}\nnot-json\n{"kind":"touch"}'),
		(error: unknown) => {
			assert.equal((error as Error).message, "invalid JSONL record at line 2");
			assert.equal((error as Error).message.includes("do-not-leak"), false);
			return true;
		},
	);
});
