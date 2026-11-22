import { apiKeyClient } from "@better-auth/api-key/client";
import { passkeyClient } from "@better-auth/passkey/client";
import { convexClient } from "@convex-dev/better-auth/client/plugins";
import {
	adminClient,
	genericOAuthClient,
	multiSessionClient,
	oidcClient,
	oneTapClient,
	organizationClient,
	twoFactorClient,
} from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { toast } from "sonner";

export const authClient: any = createAuthClient({
	plugins: [
		convexClient() as any,
		apiKeyClient() as any,
		organizationClient() as any,
		twoFactorClient({
			onTwoFactorRedirect() {
				window.location.href = "/two-factor";
			},
		}) as any,
		passkeyClient() as any,
		adminClient() as any,
		multiSessionClient() as any,
		oneTapClient({
			clientId: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID!,
			promptOptions: {
				maxAttempts: 1,
			},
		}) as any,
		oidcClient() as any,
		genericOAuthClient() as any,
	],
	fetchOptions: {
		onError(e) {
			if (e.error.status === 429) {
				toast.error("Too many requests. Please try again later.");
			}
		},
	},
});

export const {
	signUp,
	signIn,
	signOut,
	useSession,
	organization,
	useListOrganizations,
	useActiveOrganization,
} = authClient;

authClient.$store.listen("$sessionSignal", async () => {});
