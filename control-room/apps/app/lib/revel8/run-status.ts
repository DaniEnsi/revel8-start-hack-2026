import type { TraceRecord } from "./types";

const TERMINAL_RUN_STATUSES = new Set(["completed", "stopped", "failed"]);
const TERMINAL_TRACE_KINDS = new Set([
	"session_end",
	"session_ended",
	"flow_completed",
	"flow_failed",
	"stopped",
]);

export function isTerminalRunStatus(status: string | undefined): boolean {
	return status != null && TERMINAL_RUN_STATUSES.has(status);
}

export function isTerminalTraceRecord(record: TraceRecord): boolean {
	return (
		typeof record.kind === "string" && TERMINAL_TRACE_KINDS.has(record.kind)
	);
}

export function hasTerminalTraceRecord(records: TraceRecord[]): boolean {
	return records.some(isTerminalTraceRecord);
}

/** Persisted terminal evidence outranks stale sidecar or launcher process flags. */
export function resolveRunRunning({
	status,
	records = [],
	processRunning = false,
}: {
	status?: string;
	records?: TraceRecord[];
	processRunning?: boolean;
}): boolean {
	if (isTerminalRunStatus(status) || hasTerminalTraceRecord(records)) {
		return false;
	}
	return status === "running" || processRunning;
}
