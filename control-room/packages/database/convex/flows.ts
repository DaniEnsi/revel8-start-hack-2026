import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import {
	createFlowRun,
	definitionFromVersion,
	getDefinitionVersion,
	reconcileFlowRun,
	saveFlowDefinition,
} from "./flowStore";
import { requireUser } from "./operationalAuth";
import { flowRunStatusValidator } from "./schema";

export const save = mutation({
	args: {
		definition: v.any(),
		baseVersion: v.optional(v.number()),
	},
	handler: async (ctx, args) => {
		const actor = await requireUser(ctx);
		return saveFlowDefinition(ctx, actor, args);
	},
});

export const listDefinitions = query({
	args: {},
	handler: async (ctx) => {
		await requireUser(ctx);
		const definitions = await ctx.db
			.query("flowDefinitions")
			.withIndex("by_updatedAt")
			.order("desc")
			.take(100);
		return Promise.all(
			definitions.map(async (definition) => {
				const { version } = await getDefinitionVersion(ctx, definition._id);
				return { ...definition, definition: version.definition };
			}),
		);
	},
});

export const listVersions = query({
	args: { definitionId: v.id("flowDefinitions") },
	handler: async (ctx, args) => {
		await requireUser(ctx);
		return ctx.db
			.query("flowDefinitionVersions")
			.withIndex("by_definition", (q) =>
				q.eq("definitionId", args.definitionId),
			)
			.order("desc")
			.take(100);
	},
});

export const getVersion = query({
	args: {
		definitionId: v.id("flowDefinitions"),
		version: v.optional(v.number()),
	},
	handler: async (ctx, args) => {
		await requireUser(ctx);
		const { definition, version } = await getDefinitionVersion(
			ctx,
			args.definitionId,
			args.version,
		);
		return {
			definitionId: definition._id,
			flowId: definition.flowId,
			version: version.version,
			definition: definitionFromVersion(version),
		};
	},
});

export const createRun = mutation({
	args: {
		runId: v.string(),
		definitionId: v.id("flowDefinitions"),
		version: v.optional(v.number()),
		dryRun: v.boolean(),
	},
	handler: async (ctx, args) => {
		const actor = await requireUser(ctx);
		return createFlowRun(ctx, actor, args);
	},
});

const reconcileValidator = {
	runId: v.string(),
	state: v.optional(v.any()),
	statusOverride: v.optional(flowRunStatusValidator),
};

export const reconcile = mutation({
	args: reconcileValidator,
	handler: async (ctx, args) => {
		await requireUser(ctx);
		return reconcileFlowRun(ctx, args);
	},
});

export const reconcileService = internalMutation({
	args: reconcileValidator,
	handler: async (ctx, args) => reconcileFlowRun(ctx, args),
});

export const listRuns = query({
	args: {},
	handler: async (ctx) => {
		await requireUser(ctx);
		return ctx.db
			.query("flowRuns")
			.withIndex("by_updatedAt")
			.order("desc")
			.take(100);
	},
});

export const getRun = query({
	args: { runId: v.string() },
	handler: async (ctx, args) => {
		await requireUser(ctx);
		const run = await ctx.db
			.query("flowRuns")
			.withIndex("by_runId", (q) => q.eq("runId", args.runId))
			.unique();
		if (!run) return null;
		const steps = await ctx.db
			.query("flowSteps")
			.withIndex("by_run_order", (q) => q.eq("flowRunId", run._id))
			.order("asc")
			.collect();
		return { run, steps };
	},
});
