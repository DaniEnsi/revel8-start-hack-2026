import {
	type ApiDependencies,
	apiError,
	authenticationRequired,
	authorizeApi,
} from "@/lib/revel8/server-api";
import { importHistoricalTraces } from "@/lib/revel8/server-trace-sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
	_request: Request,
	dependencies: ApiDependencies = {},
) {
	const authorization = await authorizeApi(dependencies);
	if (!authorization) return authenticationRequired();
	try {
		return Response.json(
			await importHistoricalTraces(authorization.persistence),
		);
	} catch (error) {
		return apiError(error, "failed to import JSONL traces");
	}
}
