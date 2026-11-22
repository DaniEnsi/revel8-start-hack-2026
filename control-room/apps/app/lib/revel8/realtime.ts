import type { Doc } from "@x70-monorepo/database/convex/_generated/dataModel";
import { redactTraceValue } from "./redaction";
import { resolveRunRunning } from "./run-status";
import type { RunListItem, TraceRecord } from "./types";

/** Map the Convex realtime run document to the existing run-card view model. */
export function mapRunListItems(runs: Doc<"runs">[]): RunListItem[] {
	return runs.map((run) => ({
		session_id: run.sessionId,
		file: `${run.sessionId}.jsonl`,
		size: 0,
		mtime: run.updatedAt / 1000,
		running: resolveRunRunning({ status: run.status }),
		status: run.status,
		meta: {
			target: run.target,
			targetName: run.targetName,
			scenario: run.scenario,
			arms: run.arms ?? null,
			objective: run.objective,
			budget: run.budget ?? null,
			outcome: run.outcome,
			incidentTouch: run.incidentTouch ?? null,
			incidentVia: run.incidentVia ?? null,
			touchesUsed: run.touchesUsed,
			finalSuspicion: run.finalSuspicion ?? null,
			channels: run.channels,
			persona: run.persona ?? null,
			startTs: run.startTs ?? null,
			endTs: run.endTs ?? null,
			endReason: run.endReason,
		},
	}));
}

export function mergeRunListItems(
	primary: RunListItem[],
	fallback: RunListItem[],
): RunListItem[] {
	const merged = new Map<string, RunListItem>();
	for (const run of fallback) merged.set(run.session_id, run);
	for (const run of primary) {
		const legacy = merged.get(run.session_id);
		merged.set(run.session_id, {
			...run,
			running: resolveRunRunning({
				status: run.status,
				processRunning: run.running || Boolean(legacy?.running),
			}),
		});
	}
	return [...merged.values()].sort((a, b) => b.mtime - a.mtime);
}

export function traceRecordsFromQuery(
	value: { records: unknown[] } | null | undefined,
): TraceRecord[] {
	return (value?.records ?? []).flatMap((record) =>
		record && typeof record === "object" && !Array.isArray(record)
			? [redactTraceValue(record) as TraceRecord]
			: [],
	);
}
