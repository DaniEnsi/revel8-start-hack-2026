import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

export async function proxy(request: NextRequest) {
	const cookies = getSessionCookie(request);
	const url = new URL(request.url);
	const pathname = url.pathname;

	const isAuthenticated = !!cookies;

	// Handle homepage
	if (pathname === "/") {
		if (isAuthenticated) {
			return NextResponse.redirect(new URL("/dashboard", request.url));
		} else {
			return NextResponse.redirect(new URL("/sign-in", request.url));
		}
	}

	// Protect the product UI and its same-origin launcher routes.
	if (pathname.startsWith("/dashboard") && !isAuthenticated) {
		const redirectUrl = new URL("/sign-in", request.url);
		redirectUrl.searchParams.set("from", pathname);
		return NextResponse.redirect(redirectUrl);
	}
	if (pathname.startsWith("/api/revel8") && !isAuthenticated) {
		return NextResponse.json(
			{ detail: "authentication required" },
			{ status: 401 },
		);
	}

	return NextResponse.next();
}

export const config = {
	matcher: ["/", "/dashboard/:path*", "/api/revel8/:path*"],
};
