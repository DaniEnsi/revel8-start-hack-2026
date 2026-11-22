import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { requireUser } from "./operationalAuth";
import {
	ingestTraceRecords,
	mapTraceRecords,
	type TraceIngestArgs,
} from "./runStore";
import { launcherValidator, runStatusValidator } from "./schema";

const ingestValidator = {
	sessionId: v.string(),
	records: v.array(v.object({ ordinal: v.number(), detail: v.any() })),
	status: v.optional(runStatusValidator),
	plannerModel: v.optional(v.string()),
	writerModel: v.optional(v.string()),
};

export const ingest = mutation({
	args: ingestValidator,
	handler: async (ctx, args) => {
		await requireUser(ctx);
		return ingestTraceRecords(ctx, args as TraceIngestArgs);
	},
});

/** Only reachable from the authenticated service HTTP action or Convex internals. */
export const ingestService = internalMutation({
	args: ingestValidator,
	handler: async (ctx, args) => ingestTraceRecords(ctx, args as TraceIngestArgs),
});

export const list = query({
	args: {},
	handler: async (ctx) => {
		await requireUser(ctx);
		return ctx.db
			.query("runs")
			.withIndex("by_updatedAt")
			.order("desc")
			.take(200);
	},
});

export const get = query({
	args: { sessionId: v.string() },
	handler: async (ctx, args) => {
		await requireUser(ctx);
		const run = await ctx.db
			.query("runs")
			.withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
			.unique();
		if (!run) return null;
		const records = await ctx.db
			.query("traceRecords")
			.withIndex("by_sessionId", (q) => q.eq("sessionId", args.sessionId))
			.collect();
		return { run, records: mapTraceRecords(records) };
	},
});

export const analytics = query({
	args: {},
	handler: async (ctx) => {
		await requireUser(ctx);
		const runs = await ctx.db
			.query("runs")
			.withIndex("by_updatedAt")
			.order("desc")
			.take(200);
		return Promise.all(
			runs.map(async (run) => {
				const records = await ctx.db
					.query("traceRecords")
					.withIndex("by_sessionId", (q) => q.eq("sessionId", run.sessionId))
					.collect();
				return { sessionId: run.sessionId, records: mapTraceRecords(records) };
			}),
		);
	},
});

export const saveLauncher = internalMutation({
	args: { launcher: launcherValidator },
	returns: v.null(),
	handler: async (ctx, { launcher }) => {
		const row = await ctx.db
			.query("runLaunchers")
			.withIndex("by_launcher_id", (q) => q.eq("launcher.id", launcher.id))
			.unique();
		const active = launcher.status === "starting" || launcher.status === "running";
		if (row) {
			// Delayed retries cannot resurrect terminal launchers or erase a session.
			if (!row.active || (row.launcher.status === "running" && launcher.status === "starting")) return null;
			launcher.sessionId ??= row.launcher.sessionId;
			await ctx.db.patch(row._id, { launcher, active });
		} else {
			await ctx.db.insert("runLaunchers", { launcher, active });
		}
		return null;
	},
});

export const activeLaunchers = internalQuery({
	args: { paginationOpts: paginationOptsValidator },
	returns: paginationResultValidator(launcherValidator),
	handler: async (ctx, { paginationOpts }) => {
		const result = await ctx.db
			.query("runLaunchers")
			.withIndex("by_active", (q) => q.eq("active", true))
			.paginate(paginationOpts);
		return { ...result, page: result.page.map(({ launcher }) => launcher) };
	},
});
