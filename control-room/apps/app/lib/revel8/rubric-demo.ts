import {
	medianFirstIncident,
	type RubricInputs,
	type Speed,
	scoreRubric,
} from "./scoring";

export const rubricPresets = {
	A: { label: "Clean practice evidence", touches: [4, 4, null] },
	B: { label: "Stretch", touches: [4, 4, 5] },
	C: { label: "All misses", touches: [null, null, null] },
} satisfies Record<
	string,
	{
		label: string;
		touches: readonly [number | null, number | null, number | null];
	}
>;

export const illustrativeAssumptions = {
	medianRunHitShare: 0.6,
	bestTeamTopicShare: 0.8,
	qualifyingOwnAngle: false,
	wrongFactsDeduction: 0,
	craftMedianRating: 8,
	craftRatingMaximum: 10,
	architecture: 35,
	pitch: 12,
} satisfies RubricInputs;

export function scoreRubricDemo(
	preset: keyof typeof rubricPresets,
	inputs: RubricInputs,
) {
	const [first, second, third] = rubricPresets[preset].touches;
	const toSpeed = (touch: number | null): Speed =>
		touch === null ? { kind: "not-reached" } : { kind: "reached", touch };
	const incidentCount = [first, second, third].filter(
		(touch) => touch !== null,
	).length;
	const medianSpeed = medianFirstIncident([
		toSpeed(first),
		toSpeed(second),
		toSpeed(third),
	]);
	return {
		incidentCount,
		medianSpeed,
		points: scoreRubric({ incidentCount, medianSpeed, inputs }),
	};
}
