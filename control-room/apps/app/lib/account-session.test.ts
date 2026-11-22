import assert from "node:assert/strict";
import test from "node:test";
import { revokeAccountSession } from "./account-session";

test("current session revocation signs out to clear browser auth cookies", async () => {
	const calls: string[] = [];
	const client = {
		async signOut() {
			calls.push("signOut");
			return { error: null };
		},
		async revokeSession(_options: { token: string }) {
			calls.push("revokeSession");
			return { error: null };
		},
	};

	await revokeAccountSession(client, {
		token: "current-token",
		isCurrent: true,
	});

	assert.deepEqual(calls, ["signOut"]);
});

test("other session revocation keeps the browser session intact", async () => {
	const calls: string[] = [];
	const client = {
		async signOut() {
			calls.push("signOut");
			return { error: null };
		},
		async revokeSession(options: { token: string }) {
			calls.push(`revokeSession:${options.token}`);
			return { error: null };
		},
	};

	await revokeAccountSession(client, {
		token: "other-token",
		isCurrent: false,
	});

	assert.deepEqual(calls, ["revokeSession:other-token"]);
});
