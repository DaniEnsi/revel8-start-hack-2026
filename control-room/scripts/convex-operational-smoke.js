const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");

const root = path.join(__dirname, "..");
const deploymentUrl = new URL(
	process.env.CONVEX_SELF_HOSTED_URL || "http://127.0.0.1:3210",
);
if (!["127.0.0.1", "localhost", "::1"].includes(deploymentUrl.hostname)) {
	throw new Error(
		"The operational smoke test only runs against loopback Convex",
	);
}
if (!process.env.CONVEX_SELF_HOSTED_ADMIN_KEY) {
	throw new Error("CONVEX_SELF_HOSTED_ADMIN_KEY is required");
}
const identity = JSON.stringify({ subject: "convex-operational-smoke" });

function convex(args) {
	const output = execFileSync(
		"pnpm",
		[
			"--filter",
			"@x70-monorepo/database",
			"exec",
			"convex",
			...args,
			"--typecheck",
			"disable",
			"--codegen",
			"disable",
		],
		{
			cwd: root,
			env: process.env,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		},
	);
	return JSON.parse(output.trim());
}

function run(name, args, authenticated = true) {
	return convex([
		"run",
		name,
		JSON.stringify(args),
		...(authenticated ? ["--identity", identity] : []),
	]);
}

function inline(source) {
	return convex(["run", "--inline-query", source]);
}

async function main() {
	const suffix = Date.now().toString(36);
	const sessionId = `convex-smoke-${suffix}`;
	const secretCanary = `submitted-value-${suffix}`;
	const records = [
		{
			ordinal: 0,
			detail: {
				kind: "session_start",
				target_id: "julius",
				scenario: "practice",
			},
		},
		{
			ordinal: 1,
			detail: {
				kind: "touch",
				touch_idx: 1,
				plan: { decision: { action: "message", channel: "email" } },
				events: [
					{
						type: "page.submitted",
						outcome: "incident",
						fields: { email: "person@example.test" },
						values: { password: secretCanary },
					},
				],
			},
		},
	];

	assert.deepEqual(run("runs:ingest", { sessionId, records }), {
		inserted: 2,
		unchanged: 0,
		updated: 1,
	});
	assert.deepEqual(run("runs:ingest", { sessionId, records }), {
		inserted: 0,
		unchanged: 2,
		updated: 0,
	});
	const storedRun = run("runs:get", { sessionId });
	assert.equal(storedRun.run.recordCount, 2);
	assert.equal(storedRun.run.outcome, "incident");
	assert.equal(storedRun.records.length, 2);
	assert.equal(JSON.stringify(storedRun).includes(secretCanary), false);
	assert.deepEqual(storedRun.records[1].events[0].fields, ["email"]);
	const touches = inline(
		`await ctx.db.query("touches").withIndex("by_sessionId", q => q.eq("sessionId", ${JSON.stringify(sessionId)})).collect()`,
	);
	const outcomes = inline(
		`await ctx.db.query("eventOutcomes").withIndex("by_sessionId", q => q.eq("sessionId", ${JSON.stringify(sessionId)})).collect()`,
	);
	assert.equal(touches.length, 1);
	assert.equal(outcomes.length, 1);
	assert.equal(outcomes[0].outcome, "incident");
	assert.equal(
		JSON.stringify([touches, outcomes]).includes(secretCanary),
		false,
	);
	assert.throws(() => run("runs:list", {}, false), /authentication required/);

	if (process.env.REVEL8_INGEST_SECRET) {
		const site = new URL(deploymentUrl.toString());
		site.port = process.env.CONVEX_SITE_URL
			? new URL(process.env.CONVEX_SITE_URL).port
			: String(Number(deploymentUrl.port || "3210") + 1);
		const serviceSession = `${sessionId}-service`;
		const response = await fetch(`${site.origin}/revel8/ingest`, {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"x-revel8-ingest-key": process.env.REVEL8_INGEST_SECRET,
			},
			body: JSON.stringify({
				sessionId: serviceSession,
				records: [
					{ ordinal: 0, detail: { kind: "session_start", target_id: "tom" } },
				],
				status: "running",
			}),
		});
		assert.equal(response.status, 200);
		const serviceRun = run("runs:get", { sessionId: serviceSession });
		assert.equal(serviceRun.run.status, "running");
		assert.equal(serviceRun.run.target, "tom");
		assert.equal(serviceRun.records.length, 1);
	}

	const flowId = `convex-smoke-${suffix}`;
	const definition = {
		version: 1,
		flow_id: flowId,
		scenario: "practice",
		target_id: "robert",
		sender: { name: "Practice Coordinator", address: "practice-coordinator" },
		story_start: "2026-11-23T09:00:00+01:00",
		start: "opening_email",
		steps: [
			{
				id: "opening_email",
				channel: "email",
				action: "message",
				delay_seconds: 0,
				content: {
					subject: "Scheduled practice exercise",
					body: "This is a scheduled practice exercise. Reply when ready.",
				},
				wait_seconds: 5,
				on_reply: "sms_followup",
				on_timeout: "sms_followup",
			},
			{
				id: "sms_followup",
				channel: "sms",
				action: "message",
				delay_seconds: 1,
				content: { body: "This is the scheduled practice follow-up." },
				wait_seconds: 5,
				on_reply: "practice_call",
				on_timeout: "practice_call",
			},
			{
				id: "practice_call",
				channel: "phone_call",
				action: "conversation",
				delay_seconds: 1,
				content: { say: "This is the scheduled practice call." },
				next: "terminal_debrief",
			},
			{
				id: "terminal_debrief",
				channel: "email",
				action: "debrief",
				delay_seconds: 1,
				content: {
					subject: "Practice simulation debrief",
					body: "Practice simulation debrief: this authorized rehearsal is complete.",
				},
			},
		],
	};
	const saved = run("flows:save", { definition });
	assert.equal(saved.version, 1);
	const runId = `flow-smoke-${suffix}`;
	run("flows:createRun", {
		runId,
		definitionId: saved.definitionId,
		version: 1,
		dryRun: true,
	});
	const state = {
		schema_version: 1,
		run_id: runId,
		flow_id: flowId,
		definition_hash: "operational-smoke",
		scenario: "practice",
		target_id: "robert",
		session_id: `${sessionId}-flow`,
		current_step_id: "opening_email",
		status: "running",
		revision: 1,
		steps: Object.fromEntries(
			definition.steps.map((step, index) => [
				step.id,
				{
					step_id: step.id,
					status: index === 0 ? "waiting_reply" : "pending",
					values: { password: secretCanary },
				},
			]),
		),
	};
	assert.deepEqual(run("flows:reconcile", { runId, state }), {
		applied: true,
		stale: false,
	});
	assert.deepEqual(run("flows:reconcile", { runId, state }), {
		applied: false,
		stale: false,
	});
	const flow = run("flows:getRun", { runId });
	assert.equal(flow.run.revision, 1);
	assert.equal(flow.steps.length, 4);
	assert.equal(flow.steps[0].status, "waiting_reply");
	assert.equal(JSON.stringify(flow).includes(secretCanary), false);
	assert.equal(
		run("flows:listVersions", { definitionId: saved.definitionId }).length,
		1,
	);

	run("models:save", { planner: "smoke-planner", writer: "smoke-writer" });
	assert.deepEqual(run("models:get", {}), {
		planner: "smoke-planner",
		writer: "smoke-writer",
	});
	run("models:save", { planner: "kimi-k3.1", writer: "abliterated-large-v2" });
	assert.deepEqual(run("models:get", {}), {
		planner: "kimi-k3.1",
		writer: "abliterated-large-v2",
	});

	console.log(
		JSON.stringify(
			{
				ok: true,
				sessionId,
				runId,
				checks: [
					"schema-deployed",
					"authenticated-write-read",
					"sanitized-idempotency",
					"touches-and-event-outcomes",
					"service-ingest",
					"flow-versions-and-steps",
					"model-selection-defaults-restored",
				],
			},
			null,
			2,
		),
	);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
