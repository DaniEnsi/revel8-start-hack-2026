"use client";

import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConvexReactClient } from "convex/react";
import { authClient } from "@/lib/auth-client";

export function Wrapper(props: { children: React.ReactNode }) {
	return props.children;
}

const queryClient = new QueryClient();
const convex = new ConvexReactClient(
	process.env.NEXT_PUBLIC_CONVEX_URL || "http://127.0.0.1:3210",
);

export function WrapperWithQuery(props: { children: React.ReactNode }) {
	return (
		<QueryClientProvider client={queryClient}>
			<ConvexBetterAuthProvider client={convex} authClient={authClient}>
				{props.children}
			</ConvexBetterAuthProvider>
		</QueryClientProvider>
	);
}
