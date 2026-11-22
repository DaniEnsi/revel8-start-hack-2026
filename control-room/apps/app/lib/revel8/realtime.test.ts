import assert from "node:assert/strict";
import test from "node:test";
import type { Doc } from "@x70-monorepo/database/convex/_generated/dataModel";
import {
	mapRunListItems,
	mergeRunListItems,
	traceRecordsFromQuery,
} from "./realtime";
import type { RunListItem } from "./types";

function storedRun(status: Doc<"runs">["status"] = "running"): Doc<"runs"> {
	return {
		_id: "runs:one",
		_creationTime: 1,
		sessionId: "session-one",
		scenario: "practice",
		status,
		target: "julius",
		targetName: "Julius",
		objective: "practice objective",
		outcome: "in progress",
		touchesUsed: 2,
		channels: ["email"],
		endReason: "",
		recordCount: 3,
		createdAt: 1_000,
		updatedAt: 2_000,
	} as Doc<"runs">;
}

function legacyRun(sessionId: string, running: boolean): RunListItem {
	return {
		session_id: sessionId,
		file: `${sessionId}.jsonl`,
		size: 100,
		mtime: running ? 3 : 1,
		running,
		meta: { target: "tom" },
	};
}

test("Convex run documents map to sanitized realtime run cards", () => {
	const [run] = mapRunListItems([storedRun()]);
	assert.equal(run.session_id, "session-one");
	assert.equal(run.running, true);
	assert.equal(run.meta.scenario, "practice");
	assert.equal(run.meta.touchesUsed, 2);
	assert.equal(run.mtime, 2);
	assert.equal(mapRunListItems([storedRun("stopped")])[0]?.running, false);
});

test("JSONL fallback supplements Convex and terminal stored state wins", () => {
	const primary = mapRunListItems([storedRun("stopped")]);
	const merged = mergeRunListItems(primary, [
		legacyRun("session-one", true),
		legacyRun("legacy-only", false),
	]);
	assert.equal(merged.length, 2);
	assert.equal(
		merged.find((run) => run.session_id === "session-one")?.running,
		false,
	);
	assert.equal(
		merged.find((run) => run.session_id === "session-one")?.meta.target,
		"julius",
	);
	assert.equal(
		merged.some((run) => run.session_id === "legacy-only"),
		true,
	);
});

test("non-terminal Convex state still honors a live fallback process", () => {
	const primary = mapRunListItems([storedRun("unknown")]);
	const merged = mergeRunListItems(primary, [legacyRun("session-one", true)]);
	assert.equal(merged[0]?.running, true);
});

test("realtime trace mapping retains record order and rejects malformed values", () => {
	const first = {
		kind: "session_start",
		values: { password: "removed-upstream" },
	};
	const second = { kind: "touch", touch_idx: 1 };
	assert.deepEqual(
		traceRecordsFromQuery({ records: [first, second, null, []] }),
		[{ kind: "session_start" }, second],
	);
	assert.deepEqual(traceRecordsFromQuery(null), []);
});
