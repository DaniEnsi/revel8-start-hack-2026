type RevokeSessionResult = {
	error?: { message?: string | null } | null;
};

type AccountSessionAuthClient = {
	revokeSession(options: { token: string }): Promise<RevokeSessionResult>;
	signOut(): Promise<RevokeSessionResult>;
};

export async function revokeAccountSession(
	authClient: AccountSessionAuthClient,
	{ token, isCurrent }: { token: string; isCurrent: boolean },
): Promise<RevokeSessionResult> {
	if (isCurrent) {
		return authClient.signOut();
	}
	return authClient.revokeSession({ token });
}
