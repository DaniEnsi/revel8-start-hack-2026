import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { DEFAULT_MODEL_SELECTION, modelIdSchema } from "./model-config";
import { hasPersistenceCredentials, type Persistence } from "./server-convex";
import {
	contactLauncher,
	type Launcher,
	spawnLauncher,
} from "./server-launcher";
import {
	forgetLauncher,
	journalLauncher,
	launcherFolder,
	loadLaunchers,
	readLauncherState,
	saveLauncher,
} from "./server-launcher-store";
import { saveModelSelection } from "./server-models";
import { findProjectRoot } from "./server-paths";
import { type TraceWatcher, watchTraceSession } from "./server-trace-sync";
import type { RunningProc } from "./types";

export const startRunInputSchema = z
	.object({
		target: z.enum(["julius", "robert", "tom"]),
		arm_f2: z.enum(["link_free", "link_in_touch_1"]).default("link_free"),
		arm_f4: z.enum(["single", "vouch_probe"]).default("single"),
		arm_f5: z.enum(["credentials", "attachment_probe"]).default("credentials"),
		arm_f6: z.enum(["soft", "named"]).default("soft"),
		max_touches: z.number().int().min(1).max(30).nullable().default(null),
		no_live: z.boolean().default(false),
		notes: z.string().max(2000).default(""),
		planner_model: modelIdSchema.default(DEFAULT_MODEL_SELECTION.planner),
		writer_model: modelIdSchema.default(DEFAULT_MODEL_SELECTION.writer),
	})
	.strict();

export type StartRunInput = z.infer<typeof startRunInputSchema>;

export function buildAgentArgs(input: StartRunInput): string[] {
	const args = [
		"-m",
		"agent.run",
		"--target",
		input.target,
		"--scenario",
		"practice",
		"--arm-f2",
		input.arm_f2,
		"--arm-f4",
		input.arm_f4,
		"--arm-f5",
		input.arm_f5,
		"--arm-f6",
		input.arm_f6,
	];
	if (input.max_touches !== null) {
		args.push("--max-touches", String(input.max_touches));
	}
	if (input.no_live) args.push("--no-live");
	if (input.notes) args.push("--notes", input.notes);
	return args;
}

interface ManagedLauncher {
	record: Launcher;
	watcher?: TraceWatcher;
	published: boolean;
	publishing?: Promise<void>;
	live: boolean;
	finalizing?: Promise<void>;
	persistence: Persistence;
}

interface LauncherManager {
	runs: Map<string, ManagedLauncher>;
	tick?: Promise<void>;
	timer?: ReturnType<typeof setInterval>;
	persistence: Exclude<Persistence, false>;
	nextRegistryRead: number;
}

declare global {
	var revel8LauncherManager: LauncherManager | undefined;
}

function manager(): LauncherManager {
	return (globalThis.revel8LauncherManager ??= {
		runs: new Map(),
		persistence: {},
		nextRegistryRead: 0,
	});
}

const sleep = (milliseconds: number) =>
	new Promise((resolve) => setTimeout(resolve, milliseconds));

function active(record: Launcher) {
	return record.status === "starting" || record.status === "running";
}

function publicProcess({ record }: ManagedLauncher): RunningProc {
	return {
		pid: record.pid,
		session_id: record.sessionId,
		args: record.args,
		started: record.started,
		target: record.target,
		planner_model: record.models.planner,
		writer_model: record.models.writer,
	};
}

async function publish(run: ManagedLauncher) {
	if (run.published || run.persistence === false) return;
	if (run.publishing) return run.publishing;
	const record = run.record;
	run.publishing = saveLauncher(record)
		.then(() => {
			run.published = run.record === record;
		})
		.catch((error) => {
			console.error("[revel8] saving launcher to Convex failed", error);
		})
		.finally(() => {
			run.publishing = undefined;
		});
	return run.publishing;
}

function syncTrace(run: ManagedLauncher, live: boolean) {
	const { sessionId, models } = run.record;
	if (!sessionId || !hasPersistenceCredentials(run.persistence)) return;
	run.watcher ??= watchTraceSession(sessionId, run.persistence, {
		...(live ? { status: "running" } : {}),
		plannerModel: models.planner,
		writerModel: models.writer,
	});
}

function finalize(state: LauncherManager, run: ManagedLauncher) {
	if (run.finalizing) return;
	run.finalizing = (async () => {
		const { status, id, sessionId } = run.record;
		if (status === "starting" || status === "running") return;
		if (run.persistence !== false && sessionId) {
			syncTrace(run, false);
			const drained = await run.watcher?.finish(status);
			run.watcher = undefined;
			if (!drained) return;
		}
		await publish(run);
		if (run.persistence !== false && !run.published) return;
		forgetLauncher(id);
		state.runs.delete(id);
	})()
		.catch((error) => {
			console.error("[revel8] finalizing launcher failed", error);
		})
		.finally(() => {
			run.finalizing = undefined;
		});
}

async function refresh(state: LauncherManager, run: ManagedLauncher) {
	const record = run.record;
	if (!active(record)) {
		finalize(state, run);
		return;
	}
	const match = await contactLauncher(record);
	const observed = readLauncherState(record.id);
	run.live = match === "match";
	const status =
		observed && !active({ ...record, ...observed })
			? observed.status
			: match === "missing"
				? "failed"
				: (observed?.status ?? record.status);
	const sessionId = observed?.sessionId ?? record.sessionId;
	if (status !== record.status || sessionId !== record.sessionId) {
		run.record = { ...record, status, sessionId };
		run.published = false;
		if (run.persistence !== false) journalLauncher(run.record);
	}
	if (!active(run.record)) {
		run.live = false;
		finalize(state, run);
	} else if (run.live) {
		syncTrace(run, true);
		await publish(run);
	}
}

async function tick(state: LauncherManager, restore: boolean) {
	if (restore && Date.now() >= state.nextRegistryRead) {
		state.nextRegistryRead = Date.now() + 5_000;
		const known = new Set(state.runs.keys());
		for (const record of await loadLaunchers()) {
			if (known.has(record.id) || state.runs.has(record.id)) continue;
			state.runs.set(record.id, {
				record,
				persistence: state.persistence,
				published: false,
				live: false,
			});
		}
	}
	await Promise.all([...state.runs.values()].map((run) => refresh(state, run)));
}

export async function reconcileAgentProcesses(persistence: Persistence = {}) {
	const state = manager();
	if (persistence !== false && persistence.token) {
		state.persistence.token = persistence.token;
	}
	const reconcile = () => {
		state.tick ??= tick(state, persistence !== false).finally(() => {
			state.tick = undefined;
		});
		return state.tick;
	};
	if (!state.timer) {
		state.timer = setInterval(() => {
			void reconcile().catch((error) =>
				console.error("[revel8] reconciliation failed", error),
			);
		}, 500);
		state.timer.unref();
	}
	await reconcile();
}

export async function startAgentRun(
	input: StartRunInput,
	options: { persistence?: Persistence } = {},
): Promise<RunningProc> {
	const persistence = options.persistence ?? {};
	if (persistence !== false && !hasPersistenceCredentials(persistence)) {
		throw new Error("Convex persistence credentials unavailable");
	}
	await reconcileAgentProcesses(persistence);
	const launch = {
		id: randomUUID(),
		args: buildAgentArgs(input),
		target: input.target,
		models: saveModelSelection({
			planner: input.planner_model,
			writer: input.writer_model,
		}),
	};
	const root = findProjectRoot();
	const folder = launcherFolder(launch.id);
	mkdirSync(folder, { recursive: true, mode: 0o700 });
	const pid = spawnLauncher(launch, root, folder);
	if (!pid) {
		forgetLauncher(launch.id);
		throw new Error("failed to start agent launcher");
	}
	const record: Launcher = {
		...launch,
		pid,
		started: Date.now() / 1000,
		sessionId: null,
		status: "starting",
	};
	const readyBy = Date.now() + 3_000;
	while ((await contactLauncher(record)) !== "match") {
		if (Date.now() >= readyBy)
			throw new Error("agent launcher did not become ready");
		await sleep(50);
	}
	const state = manager();
	const run: ManagedLauncher = {
		record,
		published: false,
		live: true,
		persistence: persistence === false ? false : state.persistence,
	};
	if (persistence !== false) journalLauncher(record);
	state.runs.set(record.id, run);
	await publish(run);
	writeFileSync(path.join(folder, "go"), "", { mode: 0o600 });

	const deadline = Date.now() + 8000;
	do {
		await reconcileAgentProcesses(persistence);
		if (run.record.sessionId) return publicProcess(run);
		if (!active(run.record))
			throw new Error("agent exited before creating a trace");
		await sleep(200);
	} while (Date.now() < deadline);
	return publicProcess(run);
}

export async function listAgentProcesses(
	persistence?: Persistence,
): Promise<RunningProc[]> {
	await reconcileAgentProcesses(persistence);
	return [...manager().runs.values()]
		.filter((run) => run.live)
		.map(publicProcess);
}

export async function stopAgentRun(
	sessionId: string,
	persistence?: Persistence,
): Promise<boolean> {
	await reconcileAgentProcesses(persistence);
	const run = [...manager().runs.values()].find(
		(candidate) => candidate.live && candidate.record.sessionId === sessionId,
	);
	return !!run && (await contactLauncher(run.record, true)) === "match";
}
