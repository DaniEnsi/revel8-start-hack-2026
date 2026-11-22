import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const runStatusValidator = v.union(
	v.literal("unknown"),
	v.literal("running"),
	v.literal("stopped"),
	v.literal("completed"),
	v.literal("failed"),
);

export const launcherValidator = v.object({
	id: v.string(),
	pid: v.number(),
	args: v.array(v.string()),
	target: v.string(),
	started: v.number(),
	sessionId: v.union(v.string(), v.null()),
	models: v.object({ planner: v.string(), writer: v.string() }),
	status: v.union(
		v.literal("starting"),
		v.literal("running"),
		v.literal("stopped"),
		v.literal("completed"),
		v.literal("failed"),
	),
});

export const flowRunStatusValidator = v.union(
	v.literal("created"),
	v.literal("running"),
	v.literal("sleeping"),
	v.literal("waiting_reply"),
	v.literal("retry_pending"),
	v.literal("completed"),
	v.literal("stopped"),
	v.literal("failed"),
);

export const flowStepStatusValidator = v.union(
	v.literal("pending"),
	v.literal("sleeping"),
	v.literal("ready"),
	v.literal("dispatching"),
	v.literal("waiting_reply"),
	v.literal("completed"),
	v.literal("timed_out"),
	v.literal("failed"),
);

export default defineSchema({
	runLaunchers: defineTable({
		launcher: launcherValidator,
		active: v.boolean(),
	})
		.index("by_launcher_id", ["launcher.id"])
		.index("by_active", ["active"]),
	runs: defineTable({
		sessionId: v.string(),
		flowRunId: v.optional(v.string()),
		scenario: v.literal("practice"),
		status: runStatusValidator,
		target: v.string(),
		targetName: v.string(),
		arms: v.optional(v.any()),
		objective: v.string(),
		budget: v.optional(v.number()),
		outcome: v.string(),
		incidentTouch: v.optional(v.number()),
		incidentVia: v.optional(v.string()),
		touchesUsed: v.number(),
		finalSuspicion: v.optional(v.number()),
		channels: v.array(v.string()),
		persona: v.optional(v.any()),
		startTs: v.optional(v.number()),
		endTs: v.optional(v.number()),
		endReason: v.string(),
		plannerModel: v.optional(v.string()),
		writerModel: v.optional(v.string()),
		recordCount: v.number(),
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_sessionId", ["sessionId"])
		.index("by_flowRunId", ["flowRunId"])
		.index("by_status", ["status"])
		.index("by_updatedAt", ["updatedAt"]),
	traceRecords: defineTable({
		sessionId: v.string(),
		ordinal: v.number(),
		sourceKey: v.string(),
		kind: v.string(),
		ts: v.optional(v.number()),
		touchIdx: v.optional(v.number()),
		detail: v.any(),
		createdAt: v.number(),
	})
		.index("by_sourceKey", ["sourceKey"])
		.index("by_sessionId", ["sessionId"])
		.index("by_session_ordinal", ["sessionId", "ordinal"]),
	touches: defineTable({
		sessionId: v.string(),
		recordKey: v.string(),
		idx: v.optional(v.number()),
		action: v.string(),
		channel: v.string(),
		reaction: v.string(),
		suspicion: v.optional(v.number()),
		ts: v.optional(v.number()),
		detail: v.any(),
		createdAt: v.number(),
	})
		.index("by_recordKey", ["recordKey"])
		.index("by_sessionId", ["sessionId"]),
	eventOutcomes: defineTable({
		sessionId: v.string(),
		recordKey: v.string(),
		eventKey: v.string(),
		type: v.string(),
		channel: v.string(),
		outcome: v.string(),
		fields: v.array(v.string()),
		ts: v.optional(v.number()),
		detail: v.any(),
		createdAt: v.number(),
	})
		.index("by_eventKey", ["eventKey"])
		.index("by_sessionId", ["sessionId"]),
	flowDefinitions: defineTable({
		flowId: v.string(),
		latestVersion: v.number(),
		createdBy: v.string(),
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_flowId", ["flowId"])
		.index("by_updatedAt", ["updatedAt"]),
	flowDefinitionVersions: defineTable({
		definitionId: v.id("flowDefinitions"),
		flowId: v.string(),
		version: v.number(),
		definition: v.any(),
		definitionHash: v.string(),
		createdBy: v.string(),
		createdAt: v.number(),
	})
		.index("by_definition", ["definitionId"])
		.index("by_flow_version", ["flowId", "version"])
		.index("by_definition_version", ["definitionId", "version"]),
	flowRuns: defineTable({
		runId: v.string(),
		definitionId: v.id("flowDefinitions"),
		versionId: v.id("flowDefinitionVersions"),
		flowId: v.string(),
		version: v.number(),
		scenario: v.literal("practice"),
		dryRun: v.boolean(),
		status: flowRunStatusValidator,
		targetId: v.string(),
		sessionId: v.optional(v.string()),
		currentStepId: v.string(),
		revision: v.number(),
		error: v.optional(v.string()),
		detail: v.optional(v.any()),
		createdBy: v.string(),
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_runId", ["runId"])
		.index("by_sessionId", ["sessionId"])
		.index("by_updatedAt", ["updatedAt"]),
	flowSteps: defineTable({
		flowRunId: v.id("flowRuns"),
		runId: v.string(),
		stepId: v.string(),
		order: v.number(),
		status: flowStepStatusValidator,
		outcome: v.optional(v.string()),
		branchTaken: v.optional(v.string()),
		nextOperation: v.optional(v.string()),
		revision: v.number(),
		detail: v.optional(v.any()),
		createdAt: v.number(),
		updatedAt: v.number(),
	})
		.index("by_run_order", ["flowRunId", "order"])
		.index("by_run_step", ["flowRunId", "stepId"]),
	modelSelections: defineTable({
		key: v.string(),
		planner: v.string(),
		writer: v.string(),
		updatedBy: v.string(),
		updatedAt: v.number(),
	}).index("by_key", ["key"]),
});
