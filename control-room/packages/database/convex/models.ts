import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireUser } from "./operationalAuth";

const MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const SELECTION_KEY = "global";

export const get = query({
	args: {},
	handler: async (ctx) => {
		await requireUser(ctx);
		const selection = await ctx.db
			.query("modelSelections")
			.withIndex("by_key", (q) => q.eq("key", SELECTION_KEY))
			.unique();
		return selection
			? { planner: selection.planner, writer: selection.writer }
			: null;
	},
});

export const save = mutation({
	args: { planner: v.string(), writer: v.string() },
	handler: async (ctx, args) => {
		const actor = await requireUser(ctx);
		if (!MODEL_ID_RE.test(args.planner) || !MODEL_ID_RE.test(args.writer)) {
			throw new Error("invalid provider model ID");
		}
		const existing = await ctx.db
			.query("modelSelections")
			.withIndex("by_key", (q) => q.eq("key", SELECTION_KEY))
			.unique();
		const value = {
			planner: args.planner,
			writer: args.writer,
			updatedBy: actor,
			updatedAt: Date.now(),
		};
		if (existing) await ctx.db.patch(existing._id, value);
		else await ctx.db.insert("modelSelections", { key: SELECTION_KEY, ...value });
		return { planner: args.planner, writer: args.writer };
	},
});
