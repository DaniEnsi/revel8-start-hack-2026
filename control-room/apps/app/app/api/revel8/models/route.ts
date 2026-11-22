import { api } from "@x70-monorepo/database/convex/_generated/api";
import { fetchAuthMutation, fetchAuthQuery } from "@/lib/auth";
import { modelSelectionSchema } from "@/lib/revel8/model-config";
import {
	type ApiDependencies,
	apiError,
	authenticationRequired,
	authorizeApi,
} from "@/lib/revel8/server-api";
import {
	getModelChoices,
	loadModelSelection,
	saveModelSelection,
} from "@/lib/revel8/server-models";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
	_request?: Request,
	dependencies: ApiDependencies = {},
) {
	const authorization = await authorizeApi(dependencies);
	if (!authorization) return authenticationRequired();
	try {
		let selection = loadModelSelection();
		if (authorization.persistence !== false) {
			try {
				selection = (await fetchAuthQuery(api.models.get)) ?? selection;
			} catch {
				// The local file remains a read fallback during a Convex outage.
			}
		}
		return Response.json(await getModelChoices(selection));
	} catch (error) {
		return apiError(error, "failed to load model selection");
	}
}

export async function PUT(
	request: Request,
	dependencies: ApiDependencies = {},
) {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return Response.json({ detail: "invalid JSON body" }, { status: 400 });
	}
	const parsed = modelSelectionSchema.safeParse(body);
	if (!parsed.success) {
		return Response.json(
			{ detail: parsed.error.issues[0]?.message ?? "invalid model selection" },
			{ status: 400 },
		);
	}
	const authorization = await authorizeApi(dependencies);
	if (!authorization) return authenticationRequired();
	try {
		if (authorization.persistence !== false) {
			await fetchAuthMutation(api.models.save, parsed.data);
		}
		const selection = saveModelSelection(parsed.data);
		return Response.json({ selection });
	} catch (error) {
		return apiError(error, "failed to save model selection");
	}
}
