import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { authComponent, createAuth } from "./auth";
import { getSiteUrl } from "./siteUrl";

const http = httpRouter();
const siteUrl = getSiteUrl();

authComponent.registerRoutesLazy(http, createAuth, {
	basePath: "/api/auth",
	cors: true,
	trustedOrigins: [siteUrl],
});

function serviceAuthorized(request: Request): boolean {
	const configured = process.env.REVEL8_INGEST_SECRET;
	return (
		typeof configured === "string" &&
		configured.length >= 32 &&
		request.headers.get("x-revel8-ingest-key") === configured
	);
}

async function serviceBody(request: Request): Promise<unknown | null> {
	const length = Number(request.headers.get("content-length") ?? 0);
	if (length > 4_000_000) return null;
	try {
		const body: unknown = await request.json();
		return body && typeof body === "object" && !Array.isArray(body) ? body : null;
	} catch {
		return null;
	}
}

http.route({
	path: "/revel8/ingest",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		if (!serviceAuthorized(request)) {
			return Response.json({ detail: "service authorization required" }, { status: 401 });
		}
		const body = await serviceBody(request);
		if (!body) return Response.json({ detail: "invalid ingest body" }, { status: 400 });
		try {
			const result = await ctx.runMutation(internal.runs.ingestService, body as any);
			return Response.json(result);
		} catch {
			return Response.json({ detail: "trace batch rejected" }, { status: 400 });
		}
	}),
});

http.route({
	path: "/revel8/flow-state",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		if (!serviceAuthorized(request)) {
			return Response.json({ detail: "service authorization required" }, { status: 401 });
		}
		const body = await serviceBody(request);
		if (!body) return Response.json({ detail: "invalid checkpoint body" }, { status: 400 });
		try {
			const result = await ctx.runMutation(
				internal.flows.reconcileService,
				body as any,
			);
			return Response.json(result);
		} catch {
			return Response.json({ detail: "flow checkpoint rejected" }, { status: 400 });
		}
	}),
});

http.route({
	path: "/revel8/launchers",
	method: "POST",
	handler: httpAction(async (ctx, request) => {
		if (!serviceAuthorized(request)) {
			return Response.json({ detail: "service authorization required" }, { status: 401 });
		}
		const body = await serviceBody(request);
		try {
			if (body && typeof body === "object" && "launcher" in body) {
				await ctx.runMutation(internal.runs.saveLauncher, { launcher: body.launcher } as any);
				return Response.json(null);
			}
			if (body && typeof body === "object" && "cursor" in body && (body.cursor === null || typeof body.cursor === "string")) {
				return Response.json(await ctx.runQuery(internal.runs.activeLaunchers, {
					paginationOpts: { cursor: body.cursor, numItems: 100 },
				}));
			}
		} catch {
			return Response.json({ detail: "launcher operation rejected" }, { status: 400 });
		}
		return Response.json({ detail: "invalid launcher request" }, { status: 400 });
	}),
});

export default http;
