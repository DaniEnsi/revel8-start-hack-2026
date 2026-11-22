import assert from "node:assert/strict";
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
} from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { POST as launchRun } from "../../app/api/revel8/runs/route";
import { findProjectRoot } from "./server-paths";
import { listAgentProcesses, stopAgentRun } from "./server-runner";
import { buildSession, parseTraceText } from "./trace";
import type { RunningProc, TraceRecord } from "./types";

async function readJson(request: IncomingMessage): Promise<any> {
	let text = "";
	for await (const chunk of request) text += chunk;
	return text ? JSON.parse(text) : {};
}

async function listen(server: ReturnType<typeof createServer>) {
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("no test port");
	return `http://127.0.0.1:${address.port}`;
}

function json(
	response: import("node:http").ServerResponse,
	body: unknown,
	status = 200,
) {
	response.writeHead(status, { "content-type": "application/json" });
	response.end(JSON.stringify(body));
}

const sleep = (milliseconds: number) =>
	new Promise((resolve) => setTimeout(resolve, milliseconds));

test("UI launch API applies both models to a real agent and reads its actual touch", {
	timeout: 30_000,
}, async (t) => {
	const sourceRoot = findProjectRoot();
	const temporary = mkdtempSync(
		path.join(tmpdir(), "revel8-agent-integration-"),
	);
	const projectRoot = path.join(temporary, "project");
	const agentDirectory = path.join(projectRoot, "agent");
	mkdirSync(agentDirectory, { recursive: true });
	for (const file of readdirSync(path.join(sourceRoot, "agent"))) {
		if (file.endsWith(".py")) {
			copyFileSync(
				path.join(sourceRoot, "agent", file),
				path.join(agentDirectory, file),
			);
		}
	}

	const modelCalls: Array<{ model: string; system: string }> = [];
	const sentMessages: any[] = [];
	const scenarios: string[] = [];
	let planCalls = 0;
	const sessionId = "local-dashboard-integration";
	const plannerModel = "planner-integration-v1";
	const writerModel = "writer-integration-v1";

	const modelServer = createServer(async (request, response) => {
		if (request.url === "/v1/models") {
			return json(response, {
				data: [{ id: plannerModel }, { id: writerModel }],
			});
		}
		if (request.url !== "/v1/chat/completions") {
			return json(response, { error: "not found" }, 404);
		}
		const body = await readJson(request);
		const system = String(body.messages?.[0]?.content ?? "");
		modelCalls.push({ model: body.model, system });
		let content: unknown;
		if (body.model === writerModel) {
			content = {
				subject: "Confidential enterprise evaluation",
				body: "Hi Julius,\n\nThank you for taking a moment to consider our confidential enterprise evaluation. We are reviewing approaches to multi-channel security awareness for a manufacturing client and would value a short reply confirming whether this sits with you.\n\nBest regards,\nDr. Lena Hofer\nSenior Partner, Hofer & Brandt Advisory",
			};
		} else if (
			body.model === plannerModel &&
			system.includes("PRE-SEND REVIEW")
		) {
			content = { pass: true, severity: "none", issues: [], fix_hint: "" };
		} else if (body.model === plannerModel) {
			planCalls += 1;
			content =
				planCalls === 1
					? {
							analysis: "Local integration probe",
							engagement: "none",
							suspicion: 0.1,
							topic_updates: {},
							decision: {
								action: "probe",
								topic_id: "ciso_warm_intro",
								channel: "email",
								reason: "Verify the real agent-to-dashboard path",
							},
							writer_brief: {
								goal: "Confirm the right contact",
								angle: "Confidential enterprise evaluation",
								tone: "concise and professional",
								key_points: [],
								asserted_facts: [],
								cta: "short reply",
							},
						}
					: {
							analysis: "One real touch is sufficient",
							decision: { action: "bail", reason: "integration complete" },
						};
		} else {
			return json(response, { error: "unexpected model" }, 400);
		}
		return json(response, {
			choices: [
				{ message: { role: "assistant", content: JSON.stringify(content) } },
			],
		});
	});

	const targetServer = createServer(async (request, response) => {
		if (request.method === "POST" && request.url === "/sessions") {
			const body = await readJson(request);
			scenarios.push(body.scenario_id);
			return json(response, { session_id: sessionId, touch_budget: 3 });
		}
		if (
			request.method === "POST" &&
			request.url === `/sessions/${sessionId}/messages`
		) {
			sentMessages.push(await readJson(request));
			return json(response, {
				touches_used: 1,
				events: [{ type: "reply", text: "Yes, this sits with me." }],
			});
		}
		if (
			request.method === "POST" &&
			request.url === `/sessions/${sessionId}/end`
		) {
			return json(response, { status: "ended" });
		}
		return json(response, { error: "not found" }, 404);
	});

	const [modelBase, targetBase] = await Promise.all([
		listen(modelServer),
		listen(targetServer),
	]);
	const keys = [
		"REVEL8_PROJECT_ROOT",
		"REVEL8_MODEL_SETTINGS",
		"REVEL8_API_BASE",
		"REVEL8_TEAM_KEY",
		"PLANNER_BASE_URL",
		"WRITER_BASE_URL",
		"PLANNER_API_KEY",
		"WRITER_API_KEY",
		"REVEL8_PYTHON",
	] as const;
	const previous = Object.fromEntries(
		keys.map((key) => [key, process.env[key]]),
	);
	process.env.REVEL8_PROJECT_ROOT = projectRoot;
	process.env.REVEL8_MODEL_SETTINGS = path.join(
		temporary,
		"model-selection.json",
	);
	process.env.REVEL8_API_BASE = targetBase;
	process.env.REVEL8_TEAM_KEY = "loopback-only";
	process.env.PLANNER_BASE_URL = `${modelBase}/v1`;
	process.env.WRITER_BASE_URL = `${modelBase}/v1`;
	process.env.PLANNER_API_KEY = "loopback-only";
	process.env.WRITER_API_KEY = "loopback-only";
	process.env.REVEL8_PYTHON = "python3";
	let launched: RunningProc | null = null;
	t.after(async () => {
		if (launched?.session_id) await stopAgentRun(launched.session_id, false);
		for (const key of keys) {
			const value = previous[key];
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		await Promise.all(
			[modelServer, targetServer].map(
				(server) =>
					new Promise<void>((resolve, reject) =>
						server.close((error) => (error ? reject(error) : resolve())),
					),
			),
		);
		rmSync(temporary, { recursive: true, force: true });
	});

	const response = await launchRun(
		new Request("http://localhost/api/revel8/runs", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				target: "julius",
				no_live: true,
				notes: "loopback integration; no external traffic",
				planner_model: plannerModel,
				writer_model: writerModel,
			}),
		}),
		{ authorize: async () => true, persistence: false },
	);
	if (response.status !== 200) assert.fail(await response.text());
	launched = (await response.json()) as RunningProc;
	assert.equal(launched.session_id, sessionId);
	assert.equal(launched.planner_model, plannerModel);
	assert.equal(launched.writer_model, writerModel);

	const tracePath = path.join(agentDirectory, "traces", `${sessionId}.jsonl`);
	let records: TraceRecord[] = [];
	const deadline = Date.now() + 15_000;
	while (Date.now() < deadline) {
		try {
			records = parseTraceText(readFileSync(tracePath, "utf8"))?.records ?? [];
			if (records.some((record) => record.kind === "session_end")) break;
		} catch {
			// Wait for the real agent's first atomic trace append.
		}
		await sleep(100);
	}
	assert.ok(records.some((record) => record.kind === "session_end"));
	assert.equal(
		(await listAgentProcesses(false)).some((process) => process.session_id === sessionId),
		false,
	);

	const session = buildSession(sessionId, records);
	assert.equal(session.meta.target, "julius");
	assert.equal(session.meta.touchesUsed, 1);
	assert.equal(session.touches.length, 1);
	assert.equal(session.touches[0]?.action, "probe");
	assert.equal(
		session.touches[0]?.draft.subject,
		"Confidential enterprise evaluation",
	);
	assert.equal(session.meta.outcome, "bail");
	assert.equal(sentMessages.length, 1);
	assert.deepEqual(scenarios, ["practice"]);
	assert.ok(planCalls >= 2);
	assert.ok(modelCalls.some((call) => call.model === writerModel));
	assert.equal(
		modelCalls
			.filter((call) => !call.system.startsWith("You are Dr. Lena Hofer"))
			.every((call) => call.model === plannerModel),
		true,
	);
	assert.equal(
		modelCalls
			.filter((call) => call.system.startsWith("You are Dr. Lena Hofer"))
			.every((call) => call.model === writerModel),
		true,
	);
	assert.deepEqual(
		JSON.parse(
			readFileSync(process.env.REVEL8_MODEL_SETTINGS as string, "utf8"),
		),
		{ planner: plannerModel, writer: writerModel },
	);
});
