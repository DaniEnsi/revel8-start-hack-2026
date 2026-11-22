import assert from "node:assert/strict";
import { test } from "node:test";
import { type RubricInputs, scoreEvalCohort } from "./scoring";
import { buildSession } from "./trace";
import type { TraceRecord } from "./types";

function evalSession(
	id: string,
	incidentTouch: number | null,
	{
		target = id,
		scenario = "eval",
		budget = 10,
		end = true,
		outcome = incidentTouch === null ? "budget_exhausted" : "incident",
		touches = incidentTouch ?? budget,
	}: {
		target?: string;
		scenario?: string;
		budget?: number;
		end?: boolean;
		outcome?: string;
		touches?: number;
	} = {},
) {
	const records: TraceRecord[] = [
		{ kind: "session_start", target, scenario, budget },
		{ kind: "touch", touch_idx: 1, reaction: "ignored", channel: "email" },
		{
			kind: "touch",
			touch_idx: 2,
			channel: "phone_call",
			brief: { mode: "conversation", turns: 8 },
			topics: { example: { confidence: 1 } },
		},
	];
	if (end) {
		records.push({
			kind: "session_end",
			outcome,
			budget,
			touches_used: touches,
			incident: incidentTouch === null ? null : { touch_idx: incidentTouch },
		});
	}
	return buildSession(id, records);
}

const inputs: RubricInputs = {
	bestTeamContacts: 2,
	medianRunHitShare: 0.6,
	bestTeamTopicShare: 0.8,
	qualifyingOwnAngle: true,
	wrongFactsDeduction: 3,
	craftMedianRating: 4,
	craftRatingMaximum: 5,
	architecture: 35,
	pitch: 12,
};

const completeCohort = [
	evalSession("c", 10),
	evalSession("a", 2),
	evalSession("b", 4),
];

test("one incident leaves median speed not reached and speed points zero even without a benchmark", () => {
	const result = scoreEvalCohort([
		evalSession("a", 2),
		evalSession("b", null),
		evalSession("c", null),
	]);
	assert.deepEqual(result.issues, []);
	assert.equal(result.incidentCount, 1);
	assert.deepEqual(
		result.rows.map((row) => row.speed),
		[
			{ kind: "reached", touch: 2 },
			{ kind: "not-reached" },
			{ kind: "not-reached" },
		],
	);
	assert.deepEqual(
		result.rows.map((row) => row.touches),
		[2, 10, 10],
	);
	assert.deepEqual(result.medianSpeed, { kind: "not-reached" });
	assert.equal(result.points.speed, 0);
	assert.equal(result.points.results, 20 / 3);
	assert.equal(result.points.total, null);
});

test("two incidents make the later first incident the median speed", () => {
	const result = scoreEvalCohort(
		[evalSession("a", 2), evalSession("b", 7), evalSession("c", null)],
		inputs,
	);
	assert.equal(result.incidentCount, 2);
	assert.deepEqual(result.medianSpeed, { kind: "reached", touch: 7 });
	assert.equal(result.points.incidents, 40 / 3);
	assert.equal(result.points.speed, 10 / 7);
});

test("three incidents use the middle speed and the total includes every rubric component", () => {
	const result = scoreEvalCohort(completeCohort, inputs);
	assert.equal(result.incidentCount, 3);
	assert.deepEqual(result.medianSpeed, { kind: "reached", touch: 4 });
	assert.deepEqual(
		{ ...result.points, topic: Number(result.points.topic?.toFixed(3)) },
		{
			incidents: 20,
			speed: 2.5,
			results: 22.5,
			topic: 4.5,
			ownAngle: 4,
			targeting: 8.5,
			deduction: 3,
			craft: 8,
			architecture: 35,
			pitch: 12,
			total: 83,
		},
	);
});

test("maximum component scores total 100 before any deduction", () => {
	const { points } = scoreEvalCohort(completeCohort, {
		bestTeamContacts: 4,
		medianRunHitShare: 1,
		bestTeamTopicShare: 1,
		qualifyingOwnAngle: true,
		wrongFactsDeduction: 0,
		craftMedianRating: 5,
		craftRatingMaximum: 5,
		architecture: 40,
		pitch: 15,
	});
	assert.equal(points.total, 100);
});

test("explicit zero organizer values resolve components and the total", () => {
	const { points } = scoreEvalCohort(completeCohort, {
		...inputs,
		medianRunHitShare: 0,
		qualifyingOwnAngle: false,
		wrongFactsDeduction: 0,
		craftMedianRating: 0,
		architecture: 0,
		pitch: 0,
	});
	assert.equal(points.total, 22.5);
});

test("each missing organizer input keeps its component and total pending", () => {
	for (const [input, component] of [
		["bestTeamContacts", "speed"],
		["medianRunHitShare", "topic"],
		["bestTeamTopicShare", "topic"],
		["qualifyingOwnAngle", "ownAngle"],
		["wrongFactsDeduction", "deduction"],
		["craftMedianRating", "craft"],
		["craftRatingMaximum", "craft"],
		["architecture", "architecture"],
		["pitch", "pitch"],
	] satisfies [
		keyof RubricInputs,
		keyof ReturnType<typeof scoreEvalCohort>["points"],
	][]) {
		const { points } = scoreEvalCohort(completeCohort, {
			...inputs,
			[input]: undefined,
		});
		assert.equal(points[component], null, input);
		assert.equal(points.total, null, input);
		assert.equal(points.incidents, 20, input);
	}
});

test("zero denominators yield pending points even with zero numerators", () => {
	const { points } = scoreEvalCohort(completeCohort, {
		...inputs,
		bestTeamTopicShare: 0,
		medianRunHitShare: 0,
		craftRatingMaximum: 0,
		craftMedianRating: 0,
	});
	assert.equal(points.topic, null);
	assert.equal(points.targeting, null);
	assert.equal(points.craft, null);
	assert.equal(points.total, null);
	assert.equal(points.results, 22.5);
});

test("invalid organizer values keep the respective components pending", () => {
	const { points } = scoreEvalCohort(completeCohort, {
		...inputs,
		bestTeamContacts: 0,
		medianRunHitShare: 0.9,
		wrongFactsDeduction: 6,
		craftMedianRating: 6,
		architecture: 41,
		pitch: NaN,
	});
	assert.equal(points.speed, null);
	assert.equal(points.topic, null);
	assert.equal(points.deduction, null);
	assert.equal(points.craft, null);
	assert.equal(points.architecture, null);
	assert.equal(points.pitch, null);
	assert.equal(points.total, null);
});

test("duplicate targets, duplicate sessions, and practice sessions invalidate the cohort", () => {
	const first = evalSession("a", 2);
	const last = evalSession("c", null);
	const duplicateTarget = scoreEvalCohort(
		[first, evalSession("b", 4, { target: "a" }), last],
		inputs,
	);
	assert.match(
		duplicateTarget.issues.join(" "),
		/Target a appears more than once/,
	);
	assert.equal(duplicateTarget.points.total, null);
	assert.match(
		scoreEvalCohort([first, first, last], inputs).issues.join(" "),
		/each session only once/,
	);
	const practice = scoreEvalCohort(
		[first, evalSession("b", null, { scenario: "practice" }), last],
		inputs,
	);
	assert.match(practice.issues.join(" "), /not an eval session/);
	assert.equal(practice.points.total, null);
});

test("missing or incomplete sessions, missing targets and wrong budgets block the median", () => {
	const first = evalSession("a", 2);
	const last = evalSession("c", null);
	assert.match(
		scoreEvalCohort([first, last], inputs).issues.join(" "),
		/exactly three/,
	);
	assert.match(
		scoreEvalCohort([first, first, last, last], inputs).issues.join(" "),
		/exactly three/,
	);
	for (const [session, issue] of [
		[evalSession("b", null, { end: false }), /no complete eval outcome/],
		[evalSession("b", null, { touches: 8 }), /no complete eval outcome/],
		[evalSession("b", null, { budget: 8 }), /10-touch budget/],
		[evalSession("b", null, { target: "" }), /no target ID/],
	] satisfies [ReturnType<typeof evalSession>, RegExp][]) {
		const result = scoreEvalCohort([first, session, last], inputs);
		assert.match(result.issues.join(" "), issue);
		assert.equal(result.points.total, null);
	}
});

test("missing first-incident index leaves speed pending while incidents still count", () => {
	const sessions = [
		evalSession("a", null, { outcome: "incident", touches: 3 }),
		evalSession("b", 8),
		evalSession("c", null, { outcome: "dead_air", touches: 4 }),
	];
	const result = scoreEvalCohort(sessions, inputs);
	assert.deepEqual(result.issues, []);
	assert.equal(result.rows[0].incident, true);
	assert.deepEqual(result.rows[0].speed, { kind: "missing" });
	assert.deepEqual(result.rows[2].speed, { kind: "not-reached" });
	assert.deepEqual(result.medianSpeed, { kind: "missing" });
	assert.equal(result.points.incidents, 40 / 3);
	assert.equal(result.points.speed, null);
	assert.equal(result.points.results, null);
	assert.equal(result.points.total, null);
});
