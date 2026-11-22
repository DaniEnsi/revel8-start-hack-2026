import type { RunListItem, Session } from "./types";

export const ALL_FILTER_VALUES = "all";

export interface RunFilters {
	query: string;
	outcome: string;
}

export interface AnalyticsFilters {
	target: string;
	channel: string;
}

function normalized(value: string | undefined): string {
	return value?.trim().toLocaleLowerCase() ?? "";
}

export function runOutcome(run: RunListItem): string {
	if (run.running) return "running";
	const outcome = normalized(run.meta.outcome);
	if (outcome.startsWith("error") || outcome === "failed") return "error";
	return outcome || "unknown";
}

export function filterRuns(
	runs: RunListItem[],
	filters: RunFilters,
): RunListItem[] {
	const query = normalized(filters.query);
	return runs.filter((run) => {
		if (
			filters.outcome !== ALL_FILTER_VALUES &&
			runOutcome(run) !== filters.outcome
		) {
			return false;
		}
		if (!query) return true;
		return [
			run.session_id,
			run.meta.target,
			run.meta.targetName,
			run.meta.outcome,
		].some((value) => normalized(value).includes(query));
	});
}

export function runOutcomeOptions(runs: RunListItem[]): string[] {
	return [...new Set(runs.map(runOutcome))].sort((a, b) => a.localeCompare(b));
}

export function analyticsTargetOptions(sessions: Session[]): string[] {
	return [
		...new Set(sessions.map((session) => session.meta.target || "unknown")),
	].sort((a, b) => a.localeCompare(b));
}

export function analyticsChannelOptions(sessions: Session[]): string[] {
	return [
		...new Set(
			sessions.flatMap((session) =>
				session.touches.map((touch) => touch.channel).filter(Boolean),
			),
		),
	].sort((a, b) => a.localeCompare(b));
}

/** Channel filtering selects the cohort of sessions that used the channel. */
export function filterAnalyticsSessions(
	sessions: Session[],
	filters: AnalyticsFilters,
): Session[] {
	return sessions.filter((session) => {
		const target = session.meta.target || "unknown";
		if (filters.target !== ALL_FILTER_VALUES && target !== filters.target) {
			return false;
		}
		return (
			filters.channel === ALL_FILTER_VALUES ||
			session.touches.some((touch) => touch.channel === filters.channel)
		);
	});
}
