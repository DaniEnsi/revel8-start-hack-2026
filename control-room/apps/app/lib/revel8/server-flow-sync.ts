import { readFileSync } from "node:fs";
import type { FlowReconcileArgs } from "@x70-monorepo/database/convex/flowStore";
import { redactTraceValue } from "./redaction";
import { type Persistence, persistFlowCheckpoint } from "./server-convex";

type FlowStatus = NonNullable<FlowReconcileArgs["statusOverride"]>;

async function syncFlowState(
	runId: string,
	statePath: string,
	persistence: Persistence,
	statusOverride?: FlowStatus,
): Promise<string | undefined> {
	let state: unknown;
	try {
		state = JSON.parse(readFileSync(statePath, "utf8"));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT" && statusOverride) {
			state = undefined;
		} else if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return undefined;
		} else {
			throw new Error("flow checkpoint is not valid JSON");
		}
	}
	await persistFlowCheckpoint(
		{
			runId,
			state: state === undefined ? undefined : redactTraceValue(state),
			statusOverride,
		},
		persistence,
	);
	if (state && typeof state === "object" && !Array.isArray(state)) {
		const sessionId = (state as Record<string, unknown>).session_id;
		if (typeof sessionId === "string" && sessionId) return sessionId;
	}
	return undefined;
}

export interface FlowWatcher {
	finish: (status?: FlowStatus) => Promise<void>;
	stop: () => void;
}

export function watchFlowState(options: {
	runId: string;
	statePath: string;
	persistence: Persistence;
	onSession?: (sessionId: string) => void;
}): FlowWatcher {
	const { runId, statePath, persistence } = options;
	let stopped = false;
	let queue: Promise<void> = Promise.resolve();
	const enqueue = (statusOverride?: FlowStatus) => {
		queue = queue.then(async () => {
			if (stopped) return;
			try {
				const sessionId = await syncFlowState(
					runId,
					statePath,
					persistence,
					statusOverride,
				);
				if (sessionId) options.onSession?.(sessionId);
			} catch (error) {
				console.error(
					`[revel8] flow sync failed for ${runId}: ${(error as Error).message}`,
				);
			}
		});
		return queue;
	};
	const timer = setInterval(() => void enqueue(), 500);
	const watcher: FlowWatcher = {
		finish: async (status?: FlowStatus) => {
			await enqueue(status);
			watcher.stop();
		},
		stop: () => {
			stopped = true;
			clearInterval(timer);
		},
	};
	void enqueue();
	return watcher;
}
