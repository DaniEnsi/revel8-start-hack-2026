"use client";

import { usePathname, useSearchParams } from "next/navigation";
import posthog from "posthog-js";
import { PostHogProvider as PHProvider } from "posthog-js/react";
import "posthog-js/dist/posthog-recorder";
import { type ReactNode, Suspense, useEffect, useRef } from "react";
import { useSession } from "@/lib/auth-client";

interface PostHogProviderProps {
	children: ReactNode;
}

export function PostHogProvider({ children }: PostHogProviderProps) {
	useEffect(() => {
		const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
		if (key) {
			posthog.init(key, {
				api_host: "/api/app-data",
				ui_host: "https://us.posthog.com",
				capture_pageview: false, // captured manually in PostHogPageView to prevent duplicates
				capture_pageleave: true,
				person_profiles: "identified_only",
				session_recording: {
					maskAllInputs: true,
				},
			});
		}
	}, []);

	return <PHProvider client={posthog}>{children}</PHProvider>;
}

function PostHogPageViewContent() {
	const pathname = usePathname();
	const searchParams = useSearchParams();

	useEffect(() => {
		const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
		if (!key) {
			return;
		}

		if (pathname) {
			let url = window.origin + pathname;
			if (searchParams?.toString()) {
				url = `${url}?${searchParams.toString()}`;
			}
			posthog.capture("$pageview", {
				$current_url: url,
			});
		}
	}, [pathname, searchParams]);

	return null;
}

export function PostHogPageView() {
	return (
		<Suspense fallback={null}>
			<PostHogPageViewContent />
		</Suspense>
	);
}

export function PostHogAuthWrapper() {
	const { data: session, isPending } = useSession();
	const previouslyAuthenticated = useRef(false);

	useEffect(() => {
		if (isPending) return;

		if (session?.user?.id) {
			previouslyAuthenticated.current = true;
			posthog.identify(session.user.id, {
				email: session.user.email,
				name: session.user.name,
			});
		} else if (previouslyAuthenticated.current) {
			// The user just logged out during this session
			previouslyAuthenticated.current = false;
			posthog.reset();
		}
	}, [session?.user?.id, session?.user?.email, session?.user?.name, isPending]);

	return null;
}
