import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
	appendFileSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import {
	contactLauncher,
	type Launcher,
	launcherSchema,
} from "./server-launcher";
import { journalLauncher, launcherFolder } from "./server-launcher-store";
import { listAgentProcesses, stopAgentRun } from "./server-runner";

const exec = promisify(execFile);

async function waitFor(predicate: () => boolean | Promise<boolean>) {
	const deadline = Date.now() + 5_000;
	while (!(await predicate())) {
		assert.ok(Date.now() < deadline, "timed out waiting for recovery");
		await delay(25);
	}
}

test("restart recovers a live launcher, resumes JSONL ingest, and stops only the matching child", async (t) => {
	const root = mkdtempSync(path.join(tmpdir(), "revel8-process-recovery-"));
	const agent = path.join(root, "agent");
	const traces = path.join(agent, "traces");
	mkdirSync(traces, { recursive: true });
	const trace = path.join(traces, "recovery-test.jsonl");
	writeFileSync(
		path.join(agent, "run.py"),
		`
import time
with open(${JSON.stringify(trace)}, "w") as trace:
    trace.write('{"kind":"session_start","target":"tom"}\\n')
print("[00:00:00] session recovery-test started — target=tom budget=1", flush=True)
while True:
    time.sleep(1)
`,
	);

	const launchers = new Map<string, Launcher>();
	let registryAvailable = true;
	const traceWrites: Array<{
		records: Array<{ ordinal: number }>;
		status?: string;
	}> = [];
	const server = createServer(async (request, response) => {
		let text = "";
		for await (const chunk of request) text += chunk;
		const body = JSON.parse(text);
		response.setHeader("content-type", "application/json");
		if (request.url === "/revel8/launchers") {
			if (!registryAvailable) {
				response.writeHead(503).end();
				return;
			}
			if (body.launcher) {
				const record = launcherSchema.parse(body.launcher);
				launchers.set(record.id, record);
				response.end("null");
			} else {
				const page = [...launchers.values()].filter(
					({ status }) => status === "running" || status === "starting",
				);
				response.end(
					JSON.stringify({ page, isDone: true, continueCursor: "" }),
				);
			}
		} else if (request.url === "/revel8/ingest") {
			traceWrites.push(body);
			response.end(
				JSON.stringify({
					inserted: body.records.length,
					unchanged: 0,
					updated: 1,
				}),
			);
		} else {
			response.writeHead(404).end();
		}
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	assert.ok(address && typeof address === "object");
	const environment = {
		REVEL8_PROJECT_ROOT: root,
		REVEL8_MODEL_SETTINGS: path.join(root, "model-selection.json"),
		REVEL8_PYTHON: "python3",
		REVEL8_INGEST_SECRET: "recovery-test-secret-at-least-32-characters",
		CONVEX_SITE_URL: `http://127.0.0.1:${address.port}`,
	};
	const previous = Object.fromEntries(
		Object.keys(environment).map((key) => [key, process.env[key]]),
	);
	Object.assign(process.env, environment);
	t.after(async () => {
		const state = globalThis.revel8LauncherManager;
		clearInterval(state?.timer);
		await state?.tick;
		for (const run of state?.runs.values() ?? []) {
			await contactLauncher(run.record, true);
			await run.finalizing;
			run.watcher?.stop();
		}
		globalThis.revel8LauncherManager = undefined;
		server.closeAllConnections();
		await new Promise<void>((resolve) => server.close(() => resolve()));
		for (const [key, value] of Object.entries(previous)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		rmSync(root, { recursive: true, force: true });
	});

	// Exit the launcher's original Next-side owner before attempting adoption.
	await exec(
		process.execPath,
		[
			"--import",
			"tsx",
			"--eval",
			`
		const { startAgentRun, startRunInputSchema } = require("./lib/revel8/server-runner");
		startAgentRun(startRunInputSchema.parse({ target: "tom", no_live: true }))
			.then(() => process.exit(0), (error) => { console.error(error); process.exit(1); });
	`,
		],
		{ timeout: 15_000 },
	);

	const [original] = [...launchers.values()];
	assert.equal(original?.sessionId, "recovery-test");
	assert.equal(original.status, "running");
	assert.ok(original.args.includes("practice"));
	assert.deepEqual(original.models, {
		planner: "kimi-k3.1",
		writer: "abliterated-large-v2",
	});
	const reusedPid = { ...original, pid: process.pid };
	assert.notEqual(original.pid, reusedPid.pid);
	assert.equal(await contactLauncher(reusedPid, true), "missing");
	assert.equal(
		await contactLauncher({ ...original, args: ["wrong-command"] }, true),
		"missing",
	);
	assert.equal(await contactLauncher(original), "match");

	// Remove the local journal to exercise recovery from Convex alone.
	rmSync(path.join(launcherFolder(original.id), "launcher.json"));
	const dead = {
		...original,
		sessionId: "dead-test",
		id: "7abb2048-4e3f-41b0-b1f9-d2bd63da7639",
	};
	const mismatched = {
		...original,
		sessionId: null,
		id: "7abb2048-4e3f-41b0-b1f9-d2bd63da7640",
		pid: process.pid,
	};
	writeFileSync(
		path.join(traces, "dead-test.jsonl"),
		'{"kind":"session_start","target":"tom"}\n',
	);
	launchers.set(dead.id, dead);
	launchers.set(mismatched.id, mismatched);
	const recovered = await listAgentProcesses();
	assert.deepEqual(
		recovered.map(({ pid, session_id }) => [pid, session_id]),
		[[original.pid, original.sessionId]],
	);
	await waitFor(
		() =>
			launchers.get(dead.id)?.status === "failed" &&
			launchers.get(mismatched.id)?.status === "failed",
	);
	assert.equal(await stopAgentRun("dead-test"), false);

	const previousWrites = traceWrites.length;
	appendFileSync(trace, '{"kind":"touch","touch_idx":1}\n');
	await waitFor(() =>
		traceWrites
			.slice(previousWrites)
			.some(({ records }) => records.some(({ ordinal }) => ordinal === 1)),
	);
	// Exercise the same lookup while Convex is down using the private on-disk journal.
	const firstOwner = globalThis.revel8LauncherManager;
	assert.ok(firstOwner);
	clearInterval(firstOwner.timer);
	await firstOwner.tick;
	for (const run of firstOwner.runs.values()) run.watcher?.stop();
	globalThis.revel8LauncherManager = undefined;
	journalLauncher(original);
	registryAvailable = false;
	assert.deepEqual(
		(await listAgentProcesses()).map(({ pid }) => pid),
		[original.pid],
	);
	registryAvailable = true;

	assert.equal(await stopAgentRun("recovery-test"), true);
	await waitFor(() => launchers.get(original.id)?.status === "stopped");
	assert.deepEqual(await listAgentProcesses(), []);
	assert.equal(await stopAgentRun("recovery-test"), false);
	assert.ok(traceWrites.some(({ status }) => status === "stopped"));
});
