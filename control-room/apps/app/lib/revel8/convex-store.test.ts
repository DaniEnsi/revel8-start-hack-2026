import assert from "node:assert/strict";
import test from "node:test";
import type { MutationCtx } from "@x70-monorepo/database/convex/_generated/server";
import {
	createDefaultFlowDefinition,
	validateOrderedFlowDefinition,
} from "@x70-monorepo/database/convex/flowDefinition";
import {
	createFlowRun,
	reconcileFlowRun,
	saveFlowDefinition,
} from "@x70-monorepo/database/convex/flowStore";
import { ingestTraceRecords } from "@x70-monorepo/database/convex/runStore";

type Row = Record<string, unknown> & { _id: string; _creationTime: number };
type Constraints = Record<string, unknown>;

class MemoryQuery {
	private constraints: Constraints = {};
	constructor(private readonly rows: Row[]) {}

	withIndex(_name: string, build: (query: this) => unknown): this {
		build(this);
		return this;
	}

	eq(field: string, value: unknown): this {
		this.constraints[field] = value;
		return this;
	}

	order(_direction: "asc" | "desc"): this {
		return this;
	}

	private matching(): Row[] {
		return this.rows.filter((row) =>
			Object.entries(this.constraints).every(
				([key, value]) => row[key] === value,
			),
		);
	}

	async unique(): Promise<Row | null> {
		const matches = this.matching();
		if (matches.length > 1) throw new Error("non-unique test query");
		return matches[0] ?? null;
	}

	async collect(): Promise<Row[]> {
		return this.matching();
	}

	async take(limit: number): Promise<Row[]> {
		return this.matching().slice(0, limit);
	}
}

class MemoryDb {
	private readonly tables = new Map<string, Row[]>();
	private sequence = 0;

	rows(table: string): Row[] {
		const rows = this.tables.get(table) ?? [];
		this.tables.set(table, rows);
		return rows;
	}

	query(table: string): MemoryQuery {
		return new MemoryQuery(this.rows(table));
	}

	async get(id: string): Promise<Row | null> {
		for (const rows of this.tables.values()) {
			const match = rows.find((row) => row._id === id);
			if (match) return match;
		}
		return null;
	}

	async insert(table: string, value: Record<string, unknown>): Promise<string> {
		const id = `${table}:${++this.sequence}`;
		this.rows(table).push({ ...value, _id: id, _creationTime: this.sequence });
		return id;
	}

	async patch(id: string, value: Record<string, unknown>): Promise<void> {
		const row = await this.get(id);
		if (!row) throw new Error("missing test row");
		Object.assign(row, value);
	}
}

function context(db: MemoryDb): MutationCtx {
	return { db } as unknown as MutationCtx;
}

test("trace ingestion writes and reads sanitized runs, touches, and outcomes idempotently", async () => {
	const db = new MemoryDb();
	const ctx = context(db);
	const records = [
		{
			ordinal: 0,
			detail: {
				kind: "session_start",
				target_id: "julius",
				scenario: "practice",
				objective: "metadata only",
				ts: 1,
			},
		},
		{
			ordinal: 1,
			detail: {
				kind: "touch",
				touch_idx: 1,
				ts: 2,
				plan: { decision: { action: "message", channel: "email" } },
				reaction: "incident",
				events: [
					{
						type: "page.submitted",
						channel: "email",
						outcome: "incident",
						fields: { email: "person@example.test", password: "field-secret" },
						values: { password: "value-secret" },
						detail: { submittedValues: ["nested-secret"] },
					},
				],
			},
		},
		{
			ordinal: 2,
			detail: {
				kind: "session_end",
				touches_used: 1,
				final_suspicion: 0.9,
				ts: 3,
			},
		},
	];
	const first = await ingestTraceRecords(ctx, {
		sessionId: "memory-session",
		records,
		status: "completed",
	});
	assert.deepEqual(first, { inserted: 3, unchanged: 0, updated: 1 });
	assert.equal(db.rows("runs").length, 1);
	assert.equal(db.rows("traceRecords").length, 3);
	assert.equal(db.rows("touches").length, 1);
	assert.equal(db.rows("eventOutcomes").length, 1);
	assert.equal(db.rows("runs")[0]?.recordCount, 3);
	assert.equal(db.rows("runs")[0]?.outcome, "incident");
	assert.deepEqual(db.rows("eventOutcomes")[0]?.fields, ["email", "password"]);
	assert.equal(db.rows("eventOutcomes")[0]?.outcome, "incident");

	const persisted =
		JSON.stringify(db.rows("traceRecords")) +
		JSON.stringify(db.rows("touches")) +
		JSON.stringify(db.rows("eventOutcomes"));
	for (const secret of [
		"person@example.test",
		"field-secret",
		"value-secret",
		"nested-secret",
	]) {
		assert.equal(persisted.includes(secret), false);
	}
	assert.equal(persisted.includes("page.submitted"), true);

	const repeated = await ingestTraceRecords(ctx, {
		sessionId: "memory-session",
		records,
	});
	assert.deepEqual(repeated, { inserted: 0, unchanged: 3, updated: 0 });
	assert.equal(db.rows("traceRecords").length, 3);
	assert.equal(db.rows("touches").length, 1);
	assert.equal(db.rows("eventOutcomes").length, 1);
	await assert.rejects(
		ingestTraceRecords(ctx, {
			sessionId: "memory-session",
			records: [{ ordinal: 1, detail: { kind: "touch", changed: true } }],
		}),
		/conflict at ordinal 1/,
	);
});

test("trace ingestion enforces its bounded batch size", async () => {
	const ctx = context(new MemoryDb());
	await assert.rejects(
		ingestTraceRecords(ctx, {
			sessionId: "too-large",
			records: Array.from({ length: 201 }, (_, ordinal) => ({
				ordinal,
				detail: { kind: "marker" },
			})),
		}),
		/exceeds 200/,
	);
});

test("terminal status finalizes an open trace and survives reconciliation", async () => {
	for (const status of ["stopped", "failed", "completed"] as const) {
		const db = new MemoryDb();
		const ctx = context(db);
		const sessionId = "open-trace";
		await ingestTraceRecords(ctx, {
			sessionId,
			status: "running",
			records: [
				{ ordinal: 0, detail: { kind: "session_start", ts: 1 } },
				{ ordinal: 1, detail: { kind: "touch", touch_idx: 1, ts: 2 } },
			],
		});
		const [run] = db.rows("runs");
		assert.equal(run?.status, "running");
		assert.equal(run?.outcome, "in progress");

		await ingestTraceRecords(ctx, { sessionId, status, records: [] });
		assert.equal(run?.status, status);
		assert.equal(run?.outcome, status);
		assert.equal(run?.endTs, Number(run?.updatedAt) / 1000);
		assert.equal(db.rows("traceRecords").length, 2);

		const endTs = run?.endTs;
		await ingestTraceRecords(ctx, {
			sessionId,
			records: [{ ordinal: 2, detail: { kind: "marker", ts: 3 } }],
		});
		assert.equal(run?.outcome, status);
		assert.equal(run?.endTs, endTs);
	}
});

test("terminal status preserves incidents and completed dry-run trace evidence", async () => {
	const db = new MemoryDb();
	const ctx = context(db);
	await ingestTraceRecords(ctx, {
		sessionId: "stopped-incident",
		status: "stopped",
		records: [
			{
				ordinal: 0,
				detail: { kind: "touch", touch_idx: 1, ts: 2, reaction: "incident" },
			},
		],
	});
	await ingestTraceRecords(ctx, {
		sessionId: "completed-dry-run",
		status: "completed",
		records: [
			{
				ordinal: 0,
				detail: { kind: "flow_completed", outcome: "replied", ts: 45 },
			},
			{ ordinal: 1, detail: { kind: "session_ended", ts: 46 } },
		],
	});
	const [incident, completed] = db.rows("runs");
	assert.equal(incident?.outcome, "incident");
	assert.equal(incident?.endTs, 2);
	assert.equal(completed?.outcome, "completed");
	assert.equal(completed?.endTs, 46);
});

test("flow definitions, versions, run steps, and session links reconcile monotonically", async () => {
	const db = new MemoryDb();
	const ctx = context(db);
	const definition = createDefaultFlowDefinition("robert");
	const saved = await saveFlowDefinition(ctx, "test-user", { definition });
	assert.equal(saved.version, 1);
	definition.steps[0]!.content.subject = "Updated scheduled practice exercise";
	const savedNext = await saveFlowDefinition(ctx, "test-user", {
		definition,
		baseVersion: 1,
	});
	assert.equal(savedNext.version, 2);
	assert.equal(db.rows("flowDefinitionVersions").length, 2);

	const created = await createFlowRun(ctx, "test-user", {
		runId: "flow-memory-run",
		definitionId: saved.definitionId as never,
		version: 2,
		dryRun: true,
	});
	assert.equal(created.runId, "flow-memory-run");
	assert.equal(db.rows("flowSteps").length, 4);
	const steps = Object.fromEntries(
		definition.steps.map((step, index) => [
			step.id,
			{
				step_id: step.id,
				status: index === 0 ? "waiting_reply" : "pending",
				outcome: index === 0 ? "awaiting practice reply" : null,
				values: { password: "checkpoint-secret" },
			},
		]),
	);
	const state = {
		schema_version: 1,
		run_id: "flow-memory-run",
		flow_id: definition.flow_id,
		definition_hash: "test-hash",
		scenario: "practice",
		target_id: "robert",
		session_id: "flow-memory-session",
		current_step_id: definition.start,
		status: "running",
		revision: 1,
		steps,
	};
	assert.deepEqual(
		await reconcileFlowRun(ctx, { runId: created.runId, state }),
		{
			applied: true,
			stale: false,
		},
	);
	assert.equal(db.rows("flowRuns")[0]?.revision, 1);
	assert.equal(db.rows("flowRuns")[0]?.sessionId, "flow-memory-session");
	assert.equal(db.rows("flowSteps")[0]?.status, "waiting_reply");
	assert.equal(db.rows("runs")[0]?.flowRunId, "flow-memory-run");
	assert.equal(db.rows("runs")[0]?.target, "robert");
	assert.equal(
		JSON.stringify(db.rows("flowSteps")).includes("checkpoint-secret"),
		false,
	);
	assert.deepEqual(
		await reconcileFlowRun(ctx, { runId: created.runId, state }),
		{
			applied: false,
			stale: false,
		},
	);
	assert.deepEqual(
		await reconcileFlowRun(ctx, {
			runId: created.runId,
			state: { ...state, revision: 0 },
		}),
		{ applied: false, stale: true },
	);
});

test("flow editor validation is practice-only and rejects sensitive or branching input", () => {
	const valid = createDefaultFlowDefinition();
	assert.equal(validateOrderedFlowDefinition(valid).success, true);
	assert.equal(
		validateOrderedFlowDefinition({ ...valid, scenario: "eval" }).success,
		false,
	);
	const sensitive = structuredClone(valid);
	sensitive.steps[0]!.content.body =
		"Send your password and verification code.";
	const result = validateOrderedFlowDefinition(sensitive);
	assert.equal(result.success, false);
	if (!result.success) {
		assert.equal(
			result.issues.some((issue) => issue.includes("sensitive")),
			true,
		);
	}
});
