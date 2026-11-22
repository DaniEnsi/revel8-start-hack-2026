import {
	type ApiDependencies,
	authenticationRequired,
	authorizeApi,
} from "@/lib/revel8/server-api";
import { stopAgentRun } from "@/lib/revel8/server-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
	_request: Request,
	{ params }: { params: Promise<{ session: string }> },
	dependencies: ApiDependencies = {},
) {
	const authorization = await authorizeApi(dependencies);
	if (!authorization) return authenticationRequired();
	const { session } = await params;
	return Response.json({ stopped: await stopAgentRun(session, authorization.persistence) });
}
