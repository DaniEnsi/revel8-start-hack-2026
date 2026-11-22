import assert from "node:assert/strict";
import { test } from "node:test";
import { illustrativeAssumptions, scoreRubricDemo } from "./rubric-demo";

test("clean practice preset at both benchmarks has two incidents and median four", () => {
	for (const [bestTeamContacts, results, total] of [
		[1, 14.583, 74.083],
		[2, 15.833, 75.333],
	]) {
		const result = scoreRubricDemo("A", {
			...illustrativeAssumptions,
			bestTeamContacts,
		});
		assert.equal(result.incidentCount, 2);
		assert.deepEqual(result.medianSpeed, { kind: "reached", touch: 4 });
		assert.equal(Number(result.points.incidents?.toFixed(3)), 13.333);
		assert.equal(Number(result.points.results?.toFixed(3)), results);
		assert.equal(Number(result.points.targeting?.toFixed(3)), 4.5);
		assert.equal(Number(result.points.total?.toFixed(3)), total);
	}
});

test("stretch preset at both benchmarks has three incidents and median four", () => {
	for (const [bestTeamContacts, results, total] of [
		[1, 21.25, 80.75],
		[2, 22.5, 82],
	]) {
		const result = scoreRubricDemo("B", {
			...illustrativeAssumptions,
			bestTeamContacts,
		});
		assert.equal(result.incidentCount, 3);
		assert.deepEqual(result.medianSpeed, { kind: "reached", touch: 4 });
		assert.equal(result.points.incidents, 20);
		assert.equal(result.points.results, results);
		assert.equal(result.points.total, total);
	}
});

test("all misses reach zero Results and the total stays pending without assumptions", () => {
	const result = scoreRubricDemo("C", {});
	assert.equal(result.incidentCount, 0);
	assert.deepEqual(result.medianSpeed, { kind: "not-reached" });
	assert.equal(result.points.incidents, 0);
	assert.equal(result.points.speed, 0);
	assert.equal(result.points.results, 0);
	assert.equal(result.points.targeting, null);
	assert.equal(result.points.total, null);
});
