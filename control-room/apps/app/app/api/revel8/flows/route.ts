import { api } from "@x70-monorepo/database/convex/_generated/api";
import { validateOrderedFlowDefinition } from "@x70-monorepo/database/convex/flowDefinition";
import { z } from "zod";
import { fetchAuthMutation } from "@/lib/auth";
import {
	type ApiDependencies,
	apiError,
	authenticationRequired,
	authorizeApi,
} from "@/lib/revel8/server-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const saveFlowSchema = z
	.object({
		definition: z.unknown(),
		baseVersion: z.number().int().positive().optional(),
	})
	.strict();

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
	const parsed = saveFlowSchema.safeParse(body);
	if (!parsed.success) {
		return Response.json(
			{ detail: "invalid flow save request" },
			{ status: 400 },
		);
	}
	const validation = validateOrderedFlowDefinition(parsed.data.definition);
	if (!validation.success) {
		return Response.json(
			{ detail: "flow validation failed", issues: validation.issues },
			{ status: 400 },
		);
	}
	const authorization = await authorizeApi(dependencies);
	if (!authorization) return authenticationRequired();
	try {
		return Response.json(
			await fetchAuthMutation(api.flows.save, {
				definition: validation.definition,
				baseVersion: parsed.data.baseVersion,
			}),
		);
	} catch (error) {
		return apiError(error, "failed to save flow definition");
	}
}
