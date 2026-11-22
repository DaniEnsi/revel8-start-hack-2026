import assert from "node:assert/strict";
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createDefaultFlowDefinition } from "@x70-monorepo/database/convex/flowDefinition";
import {
	buildFlowAgentArgs,
	buildFlowStopArgs,
	startFlowRun,
} from "./server-flow-runner";
import { findProjectRoot } from "./server-paths";

const sleep = (milliseconds: number) =>
	new Promise((resolve) => setTimeout(resolve, milliseconds));

test("flow CLI argv uses the implemented practice/state/trace contract", () => {
	const input = {
		definitionPath: "/tmp/definition.json",
		statePath: "/tmp/run-state.json",
		traceDir: "/tmp/traces",
		runId: "flow-test-run",
		dryRun: false,
	};
	assert.deepEqual(buildFlowAgentArgs(input), [
		"-m",
		"agent.flow_run",
		"--practice",
		"/tmp/definition.json",
		"--state",
		"/tmp/run-state.json",
		"--trace-dir",
		"/tmp/traces",
		"--run-id",
		"flow-test-run",
	]);
	assert.deepEqual(
		buildFlowAgentArgs({ ...input, dryRun: true }).slice(0, 10),
		[
			"-m",
			"agent.flow_run",
			"/tmp/definition.json",
			"--dry-run",
			"--state",
			"/tmp/run-state.json",
			"--trace-dir",
			"/tmp/traces",
			"--run-id",
			"flow-test-run",
		],
	);
	assert.equal(buildFlowStopArgs(input).includes("--stop"), true);
});

test("flow editor launch path executes the real CLI dry-run and records every step", {
	timeout: 15_000,
}, async (t) => {
	const sourceRoot = findProjectRoot();
	const temporary = mkdtempSync(path.join(tmpdir(), "revel8-flow-ui-"));
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
	const previous = {
		REVEL8_PROJECT_ROOT: process.env.REVEL8_PROJECT_ROOT,
		REVEL8_FLOW_STATE_DIR: process.env.REVEL8_FLOW_STATE_DIR,
		REVEL8_PYTHON: process.env.REVEL8_PYTHON,
	};
	process.env.REVEL8_PROJECT_ROOT = projectRoot;
	process.env.REVEL8_FLOW_STATE_DIR = path.join(temporary, "flow-state");
	process.env.REVEL8_PYTHON = "python3";
	t.after(async () => {
		for (const key of Object.keys(previous) as Array<keyof typeof previous>) {
			const value = previous[key];
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		await sleep(100);
		rmSync(temporary, { recursive: true, force: true });
	});

	const runId = "flow-ui-dry-run";
	const launched = await startFlowRun({
		runId,
		definition: createDefaultFlowDefinition(),
		version: 1,
		dryRun: true,
		persistence: false,
	});
	assert.equal(launched.runId, runId);
	assert.equal(launched.definitionPath.endsWith(".json"), true);

	let state: any;
	const deadline = Date.now() + 8_000;
	while (Date.now() < deadline) {
		try {
			state = JSON.parse(readFileSync(launched.statePath, "utf8"));
			if (state.status === "completed") break;
		} catch {
			// The real CLI atomically replaces its checkpoint.
		}
		await sleep(50);
	}
	assert.equal(state?.status, "completed");
	assert.equal(state?.run_id, runId);
	assert.equal(state?.scenario, "practice");
	assert.equal(Object.keys(state?.steps ?? {}).length, 4);
	assert.equal(
		Object.values(state.steps).every((step: any) =>
			["completed", "timed_out"].includes(step.status),
		),
		true,
	);
	const closeDeadline = Date.now() + 5_000;
	while (globalThis.revel8ControlRoomFlowProcesses?.has(runId)) {
		if (Date.now() > closeDeadline)
			throw new Error("flow close reconciliation stalled");
		await sleep(25);
	}
});
