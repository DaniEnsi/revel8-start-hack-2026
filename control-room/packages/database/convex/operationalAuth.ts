import type { MutationCtx, QueryCtx } from "./_generated/server";

/** Require a verified Better Auth identity for every public operational function. */
export async function requireUser(
	ctx: QueryCtx | MutationCtx,
): Promise<string> {
	const identity = await ctx.auth.getUserIdentity();
	if (!identity?.subject) throw new Error("authentication required");
	return identity.subject;
}
