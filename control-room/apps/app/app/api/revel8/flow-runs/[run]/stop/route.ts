import {
	type ApiDependencies,
	authenticationRequired,
	authorizeApi,
} from "@/lib/revel8/server-api";
import { stopFlowRun } from "@/lib/revel8/server-flow-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
	_request: Request,
	{ params }: { params: Promise<{ run: string }> },
	dependencies: ApiDependencies = {},
) {
	const authorization = await authorizeApi(dependencies);
	if (!authorization) return authenticationRequired();
	const { run } = await params;
	if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(run)) {
		return Response.json({ detail: "invalid flow run id" }, { status: 400 });
	}
	return Response.json({ stopped: stopFlowRun(run) });
}
