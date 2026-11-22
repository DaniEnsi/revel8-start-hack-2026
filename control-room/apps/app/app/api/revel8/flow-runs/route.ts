import { randomUUID } from "node:crypto";
import { api } from "@x70-monorepo/database/convex/_generated/api";
import { assertOrderedFlowDefinition } from "@x70-monorepo/database/convex/flowDefinition";
import { z } from "zod";
import { fetchAuthMutation, fetchAuthQuery } from "@/lib/auth";
import {
	type ApiDependencies,
	apiError,
	authenticationRequired,
	authorizeApi,
} from "@/lib/revel8/server-api";
import { hasPersistenceCredentials } from "@/lib/revel8/server-convex";
import { startFlowRun } from "@/lib/revel8/server-flow-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const launchFlowSchema = z
	.object({
		definitionId: z.string().min(1).max(256),
		version: z.number().int().positive().optional(),
		dryRun: z.boolean().default(true),
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
	const parsed = launchFlowSchema.safeParse(body);
	if (!parsed.success) {
		return Response.json(
			{ detail: "invalid flow launch request" },
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
	const runId = randomUUID().replaceAll("-", "");
	try {
		const selected = await fetchAuthQuery(api.flows.getVersion, {
			definitionId: parsed.data.definitionId as never,
			version: parsed.data.version,
		});
		const definition = assertOrderedFlowDefinition(selected.definition);
		await fetchAuthMutation(api.flows.createRun, {
			runId,
			definitionId: parsed.data.definitionId as never,
			version: selected.version,
			dryRun: parsed.data.dryRun,
		});
		try {
			await startFlowRun({
				runId,
				definition,
				version: selected.version,
				dryRun: parsed.data.dryRun,
				persistence,
			});
		} catch (error) {
			await fetchAuthMutation(api.flows.reconcile, {
				runId,
				statusOverride: "failed",
			}).catch(() => undefined);
			throw error;
		}
		return Response.json({ run_id: runId, dry_run: parsed.data.dryRun });
	} catch (error) {
		return apiError(error, "failed to launch flow");
	}
}
