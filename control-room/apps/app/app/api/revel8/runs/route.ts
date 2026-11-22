import { api } from "@x70-monorepo/database/convex/_generated/api";
import { fetchAuthMutation } from "@/lib/auth";
import {
	type ApiDependencies,
	apiError,
	authenticationRequired,
	authorizeApi,
} from "@/lib/revel8/server-api";
import { hasPersistenceCredentials } from "@/lib/revel8/server-convex";
import { startAgentRun, startRunInputSchema } from "@/lib/revel8/server-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
	request: Request,
	dependencies: ApiDependencies = {},
) {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return Response.json({ detail: "invalid JSON body" }, { status: 400 });
	}
	const parsed = startRunInputSchema.safeParse(body);
	if (!parsed.success) {
		return Response.json(
			{
				detail: parsed.error.issues[0]?.message ?? "invalid run configuration",
			},
			{ status: 400 },
		);
	}
	const authorization = await authorizeApi(dependencies);
	if (!authorization) return authenticationRequired();
	const { persistence } = authorization;
	if (persistence !== false && !hasPersistenceCredentials(persistence)) {
		return Response.json(
			{ detail: "Convex persistence credentials unavailable" },
			{ status: 503 },
		);
	}
	try {
		if (persistence !== false) {
			await fetchAuthMutation(api.models.save, {
				planner: parsed.data.planner_model,
				writer: parsed.data.writer_model,
			});
		}
		return Response.json(await startAgentRun(parsed.data, { persistence }));
	} catch (error) {
		return apiError(error, "failed to launch agent");
	}
}
