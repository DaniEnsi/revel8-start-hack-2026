import { PostHog } from "posthog-node";

const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;

export const posthogServer = key
	? new PostHog(key, {
			host: "https://us.i.posthog.com",
			flushAt: 1,
			flushInterval: 0,
		})
	: null;
