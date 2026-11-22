import assert from "node:assert/strict";
import test from "node:test";
import { aggregate } from "./analytics";
import {
	ALL_FILTER_VALUES,
	analyticsChannelOptions,
	analyticsTargetOptions,
	filterAnalyticsSessions,
	filterRuns,
	runOutcome,
	runOutcomeOptions,
} from "./filters";
import { buildSession } from "./trace";
import type { RunListItem, Session, TraceRecord } from "./types";

function run(
	sessionId: string,
	target: string,
	outcome: string,
	running = false,
): RunListItem {
	return {
		session_id: sessionId,
		file: `${sessionId}.jsonl`,
		size: 1,
		mtime: 1,
		running,
		meta: { target, targetName: target.toUpperCase(), outcome },
	};
}

function session(
	id: string,
	target: string,
	channels: string[],
	outcome = "completed",
): Session {
	const records: TraceRecord[] = [
		{ kind: "session_start", target_id: target },
		...channels.map((channel, index) => ({
			kind: "touch",
			touch_idx: index + 1,
			channel,
			suspicion: index / 10,
		})),
		{ kind: "session_end", outcome },
	];
	return buildSession(id, records);
}

const runs = [
	run("email-incident", "julius", "incident"),
	run("flow-complete", "robert", "completed"),
	run("live-session", "julius", "in progress", true),
	run("legacy-partial", "tom", "in progress"),
	run("writer-error", "robert", "error: writer HTTP 400: details"),
];

test("run search matches session, target, target name, and outcome case-insensitively", () => {
	for (const [query, expected] of [
		["EMAIL-IN", ["email-incident"]],
		["robert", ["flow-complete", "writer-error"]],
		["JULIUS", ["email-incident", "live-session"]],
		["incident", ["email-incident"]],
	] as const) {
		assert.deepEqual(
			filterRuns(runs, { query, outcome: ALL_FILTER_VALUES }).map(
				(item) => item.session_id,
			),
			expected,
		);
	}
});

test("run outcome filtering uses live process state and combines with search", () => {
	assert.equal(runOutcome(runs[2]), "running");
	assert.deepEqual(runOutcomeOptions(runs), [
		"completed",
		"error",
		"in progress",
		"incident",
		"running",
	]);
	assert.deepEqual(
		filterRuns(runs, { query: "", outcome: "error" }).map(
			(item) => item.session_id,
		),
		["writer-error"],
	);
	assert.deepEqual(
		filterRuns(runs, { query: "julius", outcome: "running" }).map(
			(item) => item.session_id,
		),
		["live-session"],
	);
	assert.deepEqual(
		filterRuns(runs, { query: "", outcome: "in progress" }).map(
			(item) => item.session_id,
		),
		["legacy-partial"],
	);
});

const sessions = [
	session("j-email", "julius", ["email", "sms"], "incident"),
	session("j-sms", "julius", ["sms"]),
	session("r-email", "robert", ["email"]),
];

test("analytics target and channel filters compose with AND semantics", () => {
	assert.deepEqual(analyticsTargetOptions(sessions), ["julius", "robert"]);
	assert.deepEqual(analyticsChannelOptions(sessions), ["email", "sms"]);
	assert.deepEqual(
		filterAnalyticsSessions(sessions, {
			target: "julius",
			channel: "email",
		}).map((item) => item.id),
		["j-email"],
	);
	assert.deepEqual(
		filterAnalyticsSessions(sessions, {
			target: ALL_FILTER_VALUES,
			channel: "sms",
		}).map((item) => item.id),
		["j-email", "j-sms"],
	);
});

test("channel filtering aggregates the whole selected session cohort", () => {
	const filtered = filterAnalyticsSessions(sessions, {
		target: ALL_FILTER_VALUES,
		channel: "email",
	});
	const result = aggregate(filtered);
	assert.equal(result.totalSessions, 2);
	assert.equal(result.incidents, 1);
	assert.deepEqual(result.channelUsage, [
		{ channel: "email", count: 2 },
		{ channel: "sms", count: 1 },
	]);
	assert.deepEqual(
		filterAnalyticsSessions(sessions, {
			target: "nobody",
			channel: ALL_FILTER_VALUES,
		}),
		[],
	);
});
