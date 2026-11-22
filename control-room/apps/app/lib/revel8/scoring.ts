import type { Session } from "./types";

export const EVAL_COHORT_SIZE = 3;
export const EVAL_TOUCH_BUDGET = 10;

export type Speed =
	| { kind: "reached"; touch: number }
	| { kind: "not-reached" }
	| { kind: "missing" };

const NO_INCIDENT_OUTCOMES = new Set([
	"bail",
	"budget_exhausted",
	"dead_air",
	"session_closed",
	"suspicion_stop",
]);

export function isEvalSession(session: Session): boolean {
	return session.meta.scenario === "eval";
}

function sessionEvidence(session: Session) {
	const start = session.rows.find(
		({ rec }) => rec.kind === "session_start",
	)?.rec;
	const end = session.rows.find(({ rec }) => rec.kind === "session_end")?.rec;
	const touches = end?.touches_used;
	const validTouches =
		typeof touches === "number" &&
		Number.isInteger(touches) &&
		touches >= 0 &&
		touches <= EVAL_TOUCH_BUDGET;
	const nestedIncident = end?.incident;
	const incidentRecord =
		nestedIncident &&
		typeof nestedIncident === "object" &&
		"touch_idx" in nestedIncident
			? nestedIncident
			: null;
	const incidentTouch = session.meta.incidentTouch ?? incidentRecord?.touch_idx;
	const reached =
		session.meta.outcome === "incident" ||
		(nestedIncident != null && typeof nestedIncident === "object") ||
		incidentTouch != null ||
		session.rows.some(({ rec }) => rec.kind === "incident");
	const knownNoIncident =
		typeof end?.outcome === "string" && NO_INCIDENT_OUTCOMES.has(end.outcome);
	const completed =
		validTouches &&
		(end?.outcome === "incident" ||
			(knownNoIncident &&
				!reached &&
				(end?.outcome !== "budget_exhausted" ||
					touches === EVAL_TOUCH_BUDGET)));
	const incident = reached ? true : completed && knownNoIncident ? false : null;
	const speed: Speed =
		incident === false
			? { kind: "not-reached" }
			: reached &&
					typeof incidentTouch === "number" &&
					Number.isInteger(incidentTouch) &&
					incidentTouch >= 1 &&
					incidentTouch <= (validTouches ? touches : EVAL_TOUCH_BUDGET)
				? { kind: "reached", touch: incidentTouch }
				: { kind: "missing" };

	return {
		sessionId: session.id,
		target:
			typeof session.meta.target === "string" ? session.meta.target.trim() : "",
		touches: validTouches ? touches : null,
		tenTouchBudget:
			(start?.budget ?? end?.budget) === EVAL_TOUCH_BUDGET &&
			(end?.budget == null || end.budget === EVAL_TOUCH_BUDGET),
		completed,
		incident,
		speed,
	};
}

function median(a: number, b: number, c: number): number {
	return Math.max(Math.min(a, b), Math.min(a, c), Math.min(b, c));
}

export function medianFirstIncident([first, second, third]: readonly [
	Speed,
	Speed,
	Speed,
]): Speed {
	const [a, b, c] = [first, second, third].map((speed) =>
		speed.kind === "reached"
			? speed.touch
			: speed.kind === "not-reached"
				? Number.POSITIVE_INFINITY
				: null,
	);
	if (a == null || b == null || c == null) return { kind: "missing" };
	const middle = median(a, b, c);
	return middle === Number.POSITIVE_INFINITY
		? { kind: "not-reached" }
		: { kind: "reached", touch: middle };
}

export type RubricInputs = {
	bestTeamContacts?: number;
	medianRunHitShare?: number;
	bestTeamTopicShare?: number;
	qualifyingOwnAngle?: boolean;
	wrongFactsDeduction?: number;
	craftMedianRating?: number;
	craftRatingMaximum?: number;
	architecture?: number;
	pitch?: number;
};

function within(
	value: number | undefined,
	min: number,
	max: number,
): value is number {
	return (
		value !== undefined &&
		Number.isFinite(value) &&
		value >= min &&
		value <= max
	);
}

export function scoreRubric({
	incidentCount,
	medianSpeed,
	inputs,
}: {
	incidentCount: number | null;
	medianSpeed: Speed | null;
	inputs: RubricInputs;
}) {
	const {
		bestTeamContacts,
		medianRunHitShare,
		bestTeamTopicShare,
		qualifyingOwnAngle,
		wrongFactsDeduction,
		craftMedianRating,
		craftRatingMaximum,
		architecture,
		pitch,
	} = inputs;
	const incidents =
		incidentCount === null ? null : (20 * incidentCount) / EVAL_COHORT_SIZE;
	const speed =
		medianSpeed?.kind === "not-reached"
			? 0
			: medianSpeed?.kind === "reached" &&
					within(bestTeamContacts, 1, medianSpeed.touch) &&
					Number.isInteger(bestTeamContacts)
				? (5 * bestTeamContacts) / medianSpeed.touch
				: null;
	const results =
		incidents === null || speed === null ? null : incidents + speed;
	const topic =
		within(bestTeamTopicShare, Number.MIN_VALUE, 1) &&
		within(medianRunHitShare, 0, bestTeamTopicShare)
			? 6 * (medianRunHitShare / bestTeamTopicShare)
			: null;
	const ownAngle =
		qualifyingOwnAngle === undefined ? null : qualifyingOwnAngle ? 4 : 0;
	const targeting =
		topic === null || ownAngle === null ? null : topic + ownAngle;
	const deduction = within(wrongFactsDeduction, 0, 5)
		? wrongFactsDeduction
		: null;
	const craft =
		within(craftRatingMaximum, Number.MIN_VALUE, Number.MAX_VALUE) &&
		within(craftMedianRating, 0, craftRatingMaximum)
			? 10 * (craftMedianRating / craftRatingMaximum)
			: null;
	const architecturePoints = within(architecture, 0, 40) ? architecture : null;
	const pitchPoints = within(pitch, 0, 15) ? pitch : null;
	const total =
		results !== null &&
		targeting !== null &&
		deduction !== null &&
		craft !== null &&
		architecturePoints !== null &&
		pitchPoints !== null
			? results +
				targeting +
				craft +
				architecturePoints +
				pitchPoints -
				deduction
			: null;
	return {
		incidents,
		speed,
		results,
		topic,
		ownAngle,
		targeting,
		deduction,
		craft,
		architecture: architecturePoints,
		pitch: pitchPoints,
		total,
	};
}

export function scoreEvalCohort(
	sessions: readonly Session[],
	inputs: RubricInputs = {},
) {
	const rows = sessions.map(sessionEvidence);
	const issues: string[] = [];
	if (sessions.length !== EVAL_COHORT_SIZE) {
		issues.push("Select exactly three eval sessions.");
	}
	const sessionIds = new Set(sessions.map((session) => session.id));
	if (sessionIds.size !== sessions.length) {
		issues.push("Select each session only once.");
	}
	const targets = new Set<string>();
	for (const [index, session] of sessions.entries()) {
		const row = rows[index];
		if (!isEvalSession(session)) {
			issues.push(`${session.id} is not an eval session.`);
		}
		const { target } = row;
		if (!target) {
			issues.push(`${session.id} has no target ID.`);
		} else if (targets.has(target)) {
			issues.push(`Target ${target} appears more than once.`);
		}
		targets.add(target);
		if (!row.tenTouchBudget) {
			issues.push(`${session.id} needs a recorded 10-touch budget.`);
		}
		if (!row.completed) {
			issues.push(
				`${session.id} has no complete eval outcome and touch count.`,
			);
		}
	}

	const [first, second, third] = rows;
	const valid = issues.length === 0 && first && second && third;
	const incidentCount = valid
		? rows.filter(({ incident }) => incident === true).length
		: null;
	const medianSpeed = valid
		? medianFirstIncident([first.speed, second.speed, third.speed])
		: null;

	return {
		rows,
		issues,
		incidentCount,
		medianSpeed,
		points: scoreRubric({ incidentCount, medianSpeed, inputs }),
	};
}
