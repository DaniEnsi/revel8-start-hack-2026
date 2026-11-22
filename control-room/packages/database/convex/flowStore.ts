import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import {
	assertOrderedFlowDefinition,
	flowDefinitionDigest,
	PRACTICE_TARGETS,
	type OrderedFlowDefinition,
	type PracticeTarget,
} from "./flowDefinition";
import { redactTraceValue } from "./redaction";

type Rec = Record<string, unknown>;
type FlowRunStatus = Doc<"flowRuns">["status"];
type FlowStepStatus = Doc<"flowSteps">["status"];

const RUN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const FLOW_STATUSES = new Set<FlowRunStatus>([
	"created",
	"running",
	"sleeping",
	"waiting_reply",
	"retry_pending",
	"completed",
	"stopped",
	"failed",
]);
const STEP_STATUSES = new Set<FlowStepStatus>([
	"pending",
	"sleeping",
	"ready",
	"dispatching",
	"waiting_reply",
	"completed",
	"timed_out",
	"failed",
]);

function asRecord(value: unknown): Rec | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Rec)
		: null;
}

function optionalString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

export async function saveFlowDefinition(
	ctx: MutationCtx,
	actor: string,
	args: { definition: unknown; baseVersion?: number },
) {
	const definition = assertOrderedFlowDefinition(args.definition);
	const now = Date.now();
	const existing = await ctx.db
		.query("flowDefinitions")
		.withIndex("by_flowId", (q) => q.eq("flowId", definition.flow_id))
		.unique();
	if (existing && args.baseVersion === undefined) {
		throw new Error("flow already exists; supply its current baseVersion");
	}
	if (existing && args.baseVersion !== existing.latestVersion) {
		throw new Error("flow changed since it was loaded; reload before saving");
	}
	if (!existing && args.baseVersion !== undefined) {
		throw new Error("baseVersion is only valid for an existing flow");
	}
	const definitionId =
		existing?._id ??
		(await ctx.db.insert("flowDefinitions", {
			flowId: definition.flow_id,
			latestVersion: 1,
			createdBy: actor,
			createdAt: now,
			updatedAt: now,
		}));
	const version = (existing?.latestVersion ?? 0) + 1;
	const versionId = await ctx.db.insert("flowDefinitionVersions", {
		definitionId,
		flowId: definition.flow_id,
		version,
		definition,
		definitionHash: await flowDefinitionDigest(definition),
		createdBy: actor,
		createdAt: now,
	});
	await ctx.db.patch(definitionId, { latestVersion: version, updatedAt: now });
	return { definitionId, versionId, version };
}

export async function getDefinitionVersion(
	ctx: MutationCtx | QueryCtx,
	definitionId: Id<"flowDefinitions">,
	version?: number,
) {
	const definition = await ctx.db.get(definitionId);
	if (!definition) throw new Error("flow definition not found");
	const selectedVersion = version ?? definition.latestVersion;
	const versionDoc = await ctx.db
		.query("flowDefinitionVersions")
		.withIndex("by_definition_version", (q) =>
			q.eq("definitionId", definitionId).eq("version", selectedVersion),
		)
		.unique();
	if (!versionDoc) throw new Error("flow definition version not found");
	return { definition, version: versionDoc };
}

export async function createFlowRun(
	ctx: MutationCtx,
	actor: string,
	args: {
		runId: string;
		definitionId: Id<"flowDefinitions">;
		version?: number;
		dryRun: boolean;
	},
) {
	if (!RUN_ID_RE.test(args.runId)) throw new Error("invalid flow run id");
	const duplicate = await ctx.db
		.query("flowRuns")
		.withIndex("by_runId", (q) => q.eq("runId", args.runId))
		.unique();
	if (duplicate) throw new Error("flow run id already exists");
	const { definition, version } = await getDefinitionVersion(
		ctx,
		args.definitionId,
		args.version,
	);
	const parsed = assertOrderedFlowDefinition(version.definition);
	const now = Date.now();
	const flowRunId = await ctx.db.insert("flowRuns", {
		runId: args.runId,
		definitionId: definition._id,
		versionId: version._id,
		flowId: definition.flowId,
		version: version.version,
		scenario: "practice",
		dryRun: args.dryRun,
		status: "created",
		targetId: parsed.target_id,
		currentStepId: parsed.start,
		revision: 0,
		createdBy: actor,
		createdAt: now,
		updatedAt: now,
	});
	for (const [order, step] of parsed.steps.entries()) {
		await ctx.db.insert("flowSteps", {
			flowRunId,
			runId: args.runId,
			stepId: step.id,
			order,
			status: "pending",
			revision: 0,
			createdAt: now,
			updatedAt: now,
		});
	}
	return { runId: args.runId, flowRunId };
}

function validatedState(run: Doc<"flowRuns">, value: unknown) {
	const state = asRecord(redactTraceValue(value));
	if (!state || state.schema_version !== 1) {
		throw new Error("unsupported flow checkpoint");
	}
	if (state.run_id !== run.runId || state.flow_id !== run.flowId) {
		throw new Error("flow checkpoint identity mismatch");
	}
	if (state.scenario !== "practice") throw new Error("practice checkpoint required");
	if (!PRACTICE_TARGETS.includes(state.target_id as PracticeTarget)) {
		throw new Error("checkpoint target is outside practice");
	}
	if (
		typeof state.current_step_id !== "string" ||
		!FLOW_STATUSES.has(state.status as FlowRunStatus) ||
		!Number.isInteger(state.revision) ||
		(state.revision as number) < 0
	) {
		throw new Error("malformed flow checkpoint");
	}
	const steps = asRecord(state.steps);
	if (!steps || Object.keys(steps).length > 32) {
		throw new Error("checkpoint has no valid step state");
	}
	return { state, steps };
}

function runStatusForFlow(status: FlowRunStatus): Doc<"runs">["status"] {
	if (status === "completed") return "completed";
	if (status === "stopped") return "stopped";
	if (status === "failed") return "failed";
	return "running";
}

async function linkSessionRun(
	ctx: MutationCtx,
	flowRun: Doc<"flowRuns">,
	sessionId: string,
	status: FlowRunStatus,
	now: number,
) {
	const existing = await ctx.db
		.query("runs")
		.withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
		.unique();
	const patch = {
		flowRunId: flowRun.runId,
		target: flowRun.targetId,
		status: runStatusForFlow(status),
		updatedAt: now,
	};
	if (existing) {
		await ctx.db.patch(existing._id, patch);
		return;
	}
	await ctx.db.insert("runs", {
		sessionId,
		...patch,
		scenario: "practice",
		targetName: "",
		objective: "",
		outcome: status === "completed" ? "completed" : "in progress",
		touchesUsed: 0,
		channels: [],
		endReason: "",
		recordCount: 0,
		createdAt: now,
	});
}

export interface FlowReconcileArgs {
	runId: string;
	state?: unknown;
	statusOverride?: FlowRunStatus;
}

/** Reconcile one CLI checkpoint monotonically; equal revisions are no-ops. */
export async function reconcileFlowRun(ctx: MutationCtx, args: FlowReconcileArgs) {
	const flowRun = await ctx.db
		.query("flowRuns")
		.withIndex("by_runId", (q) => q.eq("runId", args.runId))
		.unique();
	if (!flowRun) throw new Error("flow run not found");
	if (args.statusOverride && !FLOW_STATUSES.has(args.statusOverride)) {
		throw new Error("invalid flow status");
	}
	if (args.state === undefined) {
		if (!args.statusOverride) return { applied: false, stale: false };
		await ctx.db.patch(flowRun._id, {
			status: args.statusOverride,
			updatedAt: Date.now(),
		});
		return { applied: true, stale: false };
	}
	const { state, steps } = validatedState(flowRun, args.state);
	const revision = state.revision as number;
	if (revision < flowRun.revision) {
		if (args.statusOverride && args.statusOverride !== flowRun.status) {
			await ctx.db.patch(flowRun._id, {
				status: args.statusOverride,
				updatedAt: Date.now(),
			});
		}
		return { applied: false, stale: true };
	}
	const unchanged =
		revision === flowRun.revision &&
		JSON.stringify(flowRun.detail) === JSON.stringify(state) &&
		(!args.statusOverride || args.statusOverride === flowRun.status);
	if (unchanged) return { applied: false, stale: false };
	const now = Date.now();
	const status = args.statusOverride ?? (state.status as FlowRunStatus);
	const sessionId = optionalString(state.session_id);
	await ctx.db.patch(flowRun._id, {
		status,
		targetId: state.target_id as PracticeTarget,
		sessionId,
		currentStepId: state.current_step_id as string,
		revision,
		error: optionalString(state.error),
		detail: state,
		updatedAt: now,
	});
	const existingSteps = await ctx.db
		.query("flowSteps")
		.withIndex("by_run_order", (q) => q.eq("flowRunId", flowRun._id))
		.collect();
	const stepMap = new Map(existingSteps.map((step) => [step.stepId, step]));
	for (const [stepId, rawStep] of Object.entries(steps)) {
		const existing = stepMap.get(stepId);
		if (!existing) throw new Error(`unknown checkpoint step: ${stepId}`);
		const step = asRecord(redactTraceValue(rawStep));
		if (!step || !STEP_STATUSES.has(step.status as FlowStepStatus)) {
			throw new Error(`malformed checkpoint step: ${stepId}`);
		}
		await ctx.db.patch(existing._id, {
			status: step.status as FlowStepStatus,
			outcome: optionalString(step.outcome),
			branchTaken: optionalString(step.branch_taken),
			nextOperation: optionalString(step.next_operation),
			revision,
			detail: step,
			updatedAt: now,
		});
	}
	if (sessionId) await linkSessionRun(ctx, flowRun, sessionId, status, now);
	return { applied: true, stale: false };
}

export function definitionFromVersion(version: {
	definition: unknown;
}): OrderedFlowDefinition {
	return assertOrderedFlowDefinition(version.definition);
}
