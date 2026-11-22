import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildRunViewSession } from "../../components/revel8/run-view";
import { SessionSummary } from "../../components/revel8/session-summary";
import {
	hasTerminalTraceRecord,
	isTerminalRunStatus,
	resolveRunRunning,
} from "./run-status";

const terminalKinds = [
	"session_end",
	"session_ended",
	"flow_completed",
	"flow_failed",
	"stopped",
];

test("terminal run statuses and trace markers are recognized", () => {
	for (const status of ["completed", "stopped", "failed"]) {
		assert.equal(isTerminalRunStatus(status), true);
	}
	assert.equal(isTerminalRunStatus("running"), false);
	assert.equal(isTerminalRunStatus("unknown"), false);
	for (const kind of terminalKinds) {
		assert.equal(hasTerminalTraceRecord([{ kind }]), true, kind);
	}
	assert.equal(hasTerminalTraceRecord([{ kind: "touch" }]), false);
});

test("terminal trace evidence wins over stale running status and process flags", () => {
	for (const kind of terminalKinds) {
		assert.equal(
			resolveRunRunning({
				status: "running",
				processRunning: true,
				records: [{ kind: "session_start" }, { kind }],
			}),
			false,
			kind,
		);
	}
});

test("terminal stored status wins over a stale fallback process", () => {
	for (const status of ["completed", "stopped", "failed"]) {
		assert.equal(
			resolveRunRunning({ status, processRunning: true }),
			false,
			status,
		);
	}
});

test("live autonomous and flow runs stay live before a terminal record", () => {
	assert.equal(
		resolveRunRunning({
			status: "running",
			records: [{ kind: "session_start" }, { kind: "touch" }],
		}),
		true,
	);
	assert.equal(
		resolveRunRunning({
			processRunning: true,
			records: [{ kind: "flow_started" }, { kind: "reply_wait_started" }],
		}),
		true,
	);
	assert.equal(resolveRunRunning({ status: "unknown" }), false);
});

test("run detail corrects stale stored outcomes after a terminal status update", () => {
	const records = [
		{ kind: "session_start", ts: 1 },
		{ kind: "touch", touch_idx: 1, ts: 2 },
	];
	for (const status of ["stopped", "failed", "completed"] as const) {
		const session = buildRunViewSession("open-trace", records, {
			status,
			outcome: "in progress",
			endTs: 3,
		});
		assert.equal(session.meta.outcome, status);
		assert.equal(session.meta.endTs, 3);
		const summary = renderToStaticMarkup(
			createElement(SessionSummary, { session, live: false }),
		);
		assert.ok(summary.includes(`Session ended — ${status}`));
		assert.ok(summary.includes(`>${status}</div>`));
	}
	assert.equal(
		buildRunViewSession("open-trace", records, {
			status: "running",
			outcome: "in progress",
		}).meta.outcome,
		"in progress",
	);
	assert.equal(
		buildRunViewSession("open-trace", records, {
			status: "stopped",
			outcome: "incident",
		}).meta.outcome,
		"incident",
	);
});

test("run detail preserves completed dry-run and incident trace outcomes", () => {
	const completed = buildRunViewSession(
		"dry-run",
		[
			{ kind: "flow_completed", outcome: "replied", ts: 45 },
			{ kind: "session_ended", ts: 46 },
		],
		{ status: "completed", outcome: "in progress", endTs: 47 },
	);
	assert.equal(completed.meta.outcome, "completed");
	assert.equal(completed.meta.endTs, 46);

	const incident = buildRunViewSession(
		"incident",
		[{ kind: "incident", touch_idx: 1, ts: 2 }],
		{ status: "stopped", outcome: "in progress" },
	);
	assert.equal(incident.meta.outcome, "incident");
	assert.equal(incident.meta.incidentTouch, 1);
});

test("stored incident outranks a later non-incident session end", () => {
	const session = buildRunViewSession(
		"incident-then-end",
		[
			{ kind: "incident", touch_idx: 2, ts: 2 },
			{ kind: "session_end", outcome: "budget_exhausted", ts: 3 },
		],
		{ status: "completed", outcome: "incident", endTs: 3 },
	);
	assert.equal(session.meta.outcome, "incident");
	assert.equal(session.meta.incidentTouch, 2);
});
