import type { NextRequest } from "next/server";
import { handler } from "@/lib/auth";
import { posthogServer } from "@/lib/posthog-server";

export async function GET(req: NextRequest) {
	const clonedReq = req.clone();
	const response = await handler.GET(req);

	if (response.ok && posthogServer) {
		try {
			const url = new URL(clonedReq.url);
			const path = url.pathname;

			const callbackMatch = path.match(/\/callback\/([^/]+)/);
			if (
				callbackMatch &&
				(response.status === 200 || response.status === 302)
			) {
				const provider = callbackMatch[1];
				posthogServer.capture({
					distinctId: "oauth_user",
					event: "user_login",
					properties: {
						method: provider,
						is_oauth: true,
					},
				});
			}
		} catch (error) {
			console.error("[PostHog Server Error - GET]", error);
		}
	}

	return response;
}

export async function POST(req: NextRequest) {
	const clonedReq = req.clone();
	const response = await handler.POST(req);

	if (response.ok && posthogServer) {
		try {
			const url = new URL(clonedReq.url);
			const path = url.pathname;

			if (path.endsWith("/signup/email")) {
				const body = await clonedReq.json();
				let userId = "";
				try {
					const resClone = response.clone();
					const resBody = await resClone.json();
					userId = resBody.user?.id || resBody.id || "";
				} catch (_e) {}

				posthogServer.capture({
					distinctId: userId || body.email,
					event: "user_signup",
					properties: {
						email: body.email,
						name: body.name,
						method: "email",
					},
				});
			} else if (path.endsWith("/signin/email")) {
				const body = await clonedReq.json();
				let userId = "";
				try {
					const resClone = response.clone();
					const resBody = await resClone.json();
					userId = resBody.user?.id || resBody.id || "";
				} catch (_e) {}

				posthogServer.capture({
					distinctId: userId || body.email,
					event: "user_login",
					properties: {
						email: body.email,
						method: "email",
					},
				});
			}
		} catch (error) {
			console.error("[PostHog Server Error - POST]", error);
		}
	}

	return response;
}
