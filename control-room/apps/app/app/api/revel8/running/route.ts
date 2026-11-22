import {
	type ApiDependencies,
	authenticationRequired,
	authorizeApi,
} from "@/lib/revel8/server-api";
import { listAgentProcesses } from "@/lib/revel8/server-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
	_request?: Request,
	dependencies: ApiDependencies = {},
) {
	const authorization = await authorizeApi(dependencies);
	if (!authorization) return authenticationRequired();
	return Response.json({ running: await listAgentProcesses(authorization.persistence) });
}
