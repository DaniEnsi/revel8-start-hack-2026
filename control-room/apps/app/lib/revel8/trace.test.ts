import assert from "node:assert/strict";
import test from "node:test";
import { buildSession, getTouch, normEvent } from "./trace";
import type { TraceRecord } from "./types";

const currentShape: TraceRecord = {
	kind: "touch",
	touch_idx: 1,
	target_id: "julius",
	objective: "credentials",
	suspicion: 0.1,
	touches_left: 7,
	topics: { ciso_warm_intro: { confidence: 0.65, status: "untested" } },
	plan: { ciso_warm_intro: 0.7 },
	writer_brief: {
		goal: "engage the target",
		topic: "Confidential enterprise evaluation",
		include_link: false,
	},
	draft: { subject: "Right contact?", body: "Hi Julius" },
	events: [{ type: "reply", channel: "email", body: "Yes" }],
	reaction: "replied",
};

test("current real trace shape retains recorded topic and reply channel", () => {
	const touch = getTouch(currentShape);
	assert.equal(touch.topicId, "ciso_warm_intro");
	assert.equal(touch.topicLabel, "Confidential enterprise evaluation");
	assert.equal(touch.channel, "email");
	assert.equal(touch.action, "message");
	const session = buildSession("real-shape", [currentShape]);
	assert.deepEqual(session.meta.channels, ["email"]);
});

test("recorded link intent and richer planner actions keep their meanings", () => {
	const strike = getTouch({
		...currentShape,
		events: [],
		writer_brief: { topic: "Workspace", include_link: true },
	});
	assert.equal(strike.action, "strike");
	assert.equal(strike.channel, "");
	const rich = getTouch({
		...currentShape,
		plan: {
			decision: {
				action: "build",
				channel: "linkedin_message",
				topic_id: "explicit_topic",
				reason: "Recorded planner decision",
			},
		},
	});
	assert.equal(rich.action, "build");
	assert.equal(rich.channel, "linkedin_message");
	assert.equal(rich.topicId, "explicit_topic");
	assert.equal(rich.reason, "Recorded planner decision");
});

test("message-only touches without a recorded planner action do not invent one", () => {
	const touch = getTouch({
		kind: "touch",
		touch_idx: 4,
		plan: { ciso_warm_intro: 0.4 },
		draft: {},
		events: [],
	});
	assert.equal(touch.action, "");
	assert.equal(touch.channel, "");
});

test("a 46-record completed flow trace is terminal after reload", () => {
	const records: TraceRecord[] = [
		{ kind: "flow_started", ts: 1 },
		...Array.from({ length: 43 }, (_, index) => ({
			kind: index % 2 ? "touch" : "message_recorded",
			touch_idx: index % 2 ? index + 1 : undefined,
			ts: index + 2,
		})),
		{ kind: "flow_completed", outcome: "replied", ts: 45 },
		{ kind: "session_ended", ts: 46 },
	];
	assert.equal(records.length, 46);
	const session = buildSession("dry-run-flow", records);
	assert.equal(session.meta.outcome, "completed");
	assert.notEqual(session.meta.outcome, "in progress");
	assert.notEqual(session.meta.outcome, "replied");
	assert.equal(session.meta.endTs, 46);
});

test("session end markers cannot leave an active outcome or stale running state", () => {
	const incident = buildSession("autonomous", [
		{ kind: "session_start", target_id: "julius" },
		{ kind: "touch", touch_idx: 1, reaction: "incident" },
		{ kind: "session_end", outcome: "in progress", ts: 20 },
	]);
	assert.equal(incident.meta.outcome, "incident");
	const ended = buildSession("autonomous-clean", [
		{ kind: "session_start", target_id: "julius" },
		{ kind: "session_end", ts: 20 },
	]);
	assert.equal(ended.meta.outcome, "ended");
});

test("event normalization retains field names but never their submitted values", () => {
	const event = normEvent({
		type: "page.submitted",
		fields: { email: "person@example.test", password: "secret" },
		values: { email: "person@example.test", password: "secret" },
	});
	assert.deepEqual(event.fields, ["email", "password"]);
	assert.equal(JSON.stringify(event.fields).includes("secret"), false);
});
