import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { OrderedFlowDefinition } from "@x70-monorepo/database/convex/flowDefinition";
import {
	hasPersistenceCredentials,
	type Persistence,
	persistFlowCheckpoint,
} from "./server-convex";
import { type FlowWatcher, watchFlowState } from "./server-flow-sync";
import { findProjectRoot, flowStateDirectory } from "./server-paths";
import {
	type TraceWatcher,
	traceDirectory,
	watchTraceSession,
} from "./server-trace-sync";

interface FlowProcess {
	child: ChildProcess;
	args: string[];
	runId: string;
	definitionPath: string;
	statePath: string;
	dryRun: boolean;
	started: number;
	output: string;
	spawnError: Error | null;
	stopRequested: boolean;
	persistence: Persistence;
	watcher: FlowWatcher | null;
	traceWatcher: TraceWatcher | null;
}

declare global {
	var revel8ControlRoomFlowProcesses: Map<string, FlowProcess> | undefined;
}

const processes =
	globalThis.revel8ControlRoomFlowProcesses ?? new Map<string, FlowProcess>();
globalThis.revel8ControlRoomFlowProcesses = processes;

const sleep = (milliseconds: number) =>
	new Promise((resolve) => setTimeout(resolve, milliseconds));

function isRunning(run: FlowProcess): boolean {
	return (
		!run.spawnError && run.child.exitCode === null && !run.child.signalCode
	);
}

export interface FlowCommandInput {
	definitionPath: string;
	statePath: string;
	traceDir: string;
	runId: string;
	dryRun: boolean;
}

export function buildFlowAgentArgs(input: FlowCommandInput): string[] {
	const args = input.dryRun
		? ["-m", "agent.flow_run", input.definitionPath, "--dry-run"]
		: ["-m", "agent.flow_run", "--practice", input.definitionPath];
	args.push(
		"--state",
		input.statePath,
		"--trace-dir",
		input.traceDir,
		"--run-id",
		input.runId,
	);
	return args;
}

export function buildFlowStopArgs(
	input: Omit<FlowCommandInput, "runId">,
): string[] {
	const args = input.dryRun
		? ["-m", "agent.flow_run", input.definitionPath, "--dry-run"]
		: ["-m", "agent.flow_run", "--practice", input.definitionPath];
	args.push(
		"--state",
		input.statePath,
		"--trace-dir",
		input.traceDir,
		"--stop",
	);
	return args;
}

function writeDefinitionAtomic(
	file: string,
	definition: OrderedFlowDefinition,
) {
	mkdirSync(path.dirname(file), { recursive: true });
	const temporary = `${file}.${process.pid}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(definition, null, 2)}\n`, {
		encoding: "utf8",
		mode: 0o600,
	});
	renameSync(temporary, file);
}

export interface StartFlowInput {
	runId: string;
	definition: OrderedFlowDefinition;
	version: number;
	dryRun: boolean;
	persistence?: Persistence;
}

export async function startFlowRun(input: StartFlowInput) {
	const persistence = input.persistence ?? {};
	if (persistence !== false && !hasPersistenceCredentials(persistence)) {
		throw new Error("Convex persistence credentials unavailable");
	}
	const root = flowStateDirectory();
	const definitionPath = path.join(
		root,
		"definitions",
		`${input.definition.flow_id}-v${input.version}.json`,
	);
	const statePath = path.join(root, "runs", `${input.runId}.json`);
	if (existsSync(statePath)) throw new Error("flow checkpoint already exists");
	writeDefinitionAtomic(definitionPath, input.definition);
	mkdirSync(path.dirname(statePath), { recursive: true });
	const args = buildFlowAgentArgs({
		definitionPath,
		statePath,
		traceDir: traceDirectory(),
		runId: input.runId,
		dryRun: input.dryRun,
	});
	const child = spawn(process.env.REVEL8_PYTHON || "python3", args, {
		cwd: findProjectRoot(),
		env: process.env,
		detached: true,
		stdio: ["ignore", "pipe", "pipe"],
	});
	if (!child.pid)
		throw new Error("failed to spawn flow process: no PID returned");
	const run: FlowProcess = {
		child,
		args,
		runId: input.runId,
		definitionPath,
		statePath,
		dryRun: input.dryRun,
		started: Date.now() / 1000,
		output: "",
		spawnError: null,
		stopRequested: false,
		persistence,
		watcher: null,
		traceWatcher: null,
	};
	run.watcher = watchFlowState({
		runId: input.runId,
		statePath,
		persistence,
		onSession: (sessionId) => {
			if (run.traceWatcher) return;
			run.traceWatcher = watchTraceSession(sessionId, persistence, {
				status: "running",
			});
		},
	});
	const capture = (chunk: Buffer) => {
		run.output = `${run.output}${chunk.toString("utf8")}`.slice(-16_000);
	};
	child.stdout?.on("data", capture);
	child.stderr?.on("data", capture);
	child.unref();
	for (const stream of [child.stdout, child.stderr]) {
		if (stream && "unref" in stream && typeof stream.unref === "function") {
			stream.unref();
		}
	}
	child.on("error", (error) => {
		run.spawnError = error;
	});
	processes.set(input.runId, run);
	child.on("close", (code, signal) => {
		void (async () => {
			const status = run.stopRequested
				? "stopped"
				: signal || code !== 0
					? "failed"
					: "completed";
			// The final checkpoint can reveal session_id, so finish flow reconciliation
			// before closing the trace watcher it may have created.
			await run.watcher?.finish(status);
			await run.traceWatcher?.finish(status);
			run.child.stdout?.destroy();
			run.child.stderr?.destroy();
			processes.delete(input.runId);
		})();
	});

	const deadline = Date.now() + 8000;
	while (Date.now() < deadline) {
		if (existsSync(statePath) || !isRunning(run)) break;
		await sleep(200);
	}
	if (!existsSync(statePath) && !isRunning(run)) {
		run.watcher?.stop();
		run.traceWatcher?.stop();
		processes.delete(input.runId);
		const detail =
			run.spawnError?.message ||
			run.output.trim().split(/\r?\n/).slice(-8).join("\n") ||
			"no flow output";
		throw new Error(`flow exited before creating a checkpoint: ${detail}`);
	}
	return { runId: input.runId, statePath, definitionPath };
}

export function stopFlowRun(runId: string): boolean {
	const run = processes.get(runId);
	if (!run || !isRunning(run)) return false;
	const stopper = spawn(
		process.env.REVEL8_PYTHON || "python3",
		buildFlowStopArgs({
			definitionPath: run.definitionPath,
			statePath: run.statePath,
			traceDir: traceDirectory(),
			dryRun: run.dryRun,
		}),
		{
			cwd: findProjectRoot(),
			env: process.env,
			detached: false,
			stdio: "ignore",
		},
	);
	run.stopRequested = true;
	void persistFlowCheckpoint(
		{ runId, statusOverride: "stopped" },
		run.persistence,
	).catch(() => undefined);
	const forceStop = () => {
		if (!isRunning(run)) return;
		try {
			process.kill(-run.child.pid!, "SIGTERM");
		} catch {
			run.child.kill("SIGTERM");
		}
	};
	stopper.on("error", forceStop);
	stopper.on("close", (code) => {
		if (code !== 0) forceStop();
		else setTimeout(forceStop, 2500).unref();
	});
	return true;
}
