import { api } from "@x70-monorepo/database/convex/_generated/api";
import type { FlowReconcileArgs } from "@x70-monorepo/database/convex/flowStore";
import type { TraceIngestArgs } from "@x70-monorepo/database/convex/runStore";
import { ConvexHttpClient } from "convex/browser";

export type Persistence = { token?: string } | false;

export function convexUrl(): string {
	return (
		process.env.CONVEX_URL ||
		process.env.NEXT_PUBLIC_CONVEX_URL ||
		"http://127.0.0.1:3210"
	).replace(/\/$/, "");
}

export function convexSiteUrl(): string {
	return (
		process.env.CONVEX_SITE_URL ||
		process.env.NEXT_PUBLIC_CONVEX_SITE_URL ||
		"http://127.0.0.1:3211"
	).replace(/\/$/, "");
}

export function serviceSecret(): string | null {
	const secret = process.env.REVEL8_INGEST_SECRET;
	return secret && secret.length >= 32 ? secret : null;
}

export function hasPersistenceCredentials(persistence: Persistence): boolean {
	return persistence !== false && Boolean(serviceSecret() || persistence.token);
}

export async function serviceMutation(
	path: string,
	body: unknown,
): Promise<unknown> {
	const secret = serviceSecret();
	if (!secret) throw new Error("service ingestion is not configured");
	const response = await fetch(`${convexSiteUrl()}/revel8/${path}`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			"x-revel8-ingest-key": secret,
		},
		body: JSON.stringify(body),
		cache: "no-store",
		signal: AbortSignal.timeout(5_000),
	});
	if (!response.ok)
		throw new Error(`Convex service ingest failed (${response.status})`);
	return response.json();
}

function client(token: string): ConvexHttpClient {
	return new ConvexHttpClient(convexUrl(), { auth: token, logger: false });
}

export async function persistTraceBatch(
	args: TraceIngestArgs,
	persistence: Persistence,
): Promise<unknown> {
	if (persistence === false) return null;
	if (serviceSecret()) return serviceMutation("ingest", args);
	if (!persistence.token)
		throw new Error("Convex persistence token unavailable");
	return client(persistence.token).mutation(api.runs.ingest, args);
}

export async function persistFlowCheckpoint(
	args: FlowReconcileArgs,
	persistence: Persistence,
): Promise<unknown> {
	if (persistence === false) return null;
	if (serviceSecret()) return serviceMutation("flow-state", args);
	if (!persistence.token)
		throw new Error("Convex persistence token unavailable");
	return client(persistence.token).mutation(api.flows.reconcile, args);
}
