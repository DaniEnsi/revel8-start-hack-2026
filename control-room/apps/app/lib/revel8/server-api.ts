import { getToken, isAuthenticated } from "@/lib/auth";
import type { Persistence } from "./server-convex";

export interface ApiDependencies {
	authorize?: () => Promise<boolean>;
	token?: () => Promise<string | undefined>;
	/** Explicit unit-test seam; production routes always leave this enabled. */
	persistence?: boolean;
	/** Next.js supplies this route context as the second argument in production. */
	params?: Promise<unknown>;
}

export async function authorizeApi(
	dependencies: ApiDependencies = {},
): Promise<{ persistence: Persistence } | null> {
	const authorized = await (dependencies.authorize ?? isAuthenticated)();
	if (!authorized) return null;
	if (dependencies.persistence === false) return { persistence: false };
	const token = await (dependencies.token ?? getToken)();
	return { persistence: { token } };
}

export function authenticationRequired(): Response {
	return Response.json({ detail: "authentication required" }, { status: 401 });
}

export function apiError(error: unknown, fallback: string): Response {
	return Response.json(
		{ detail: error instanceof Error ? error.message : fallback },
		{ status: 500 },
	);
}
