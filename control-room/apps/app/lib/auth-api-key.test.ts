import assert from "node:assert/strict";
import test from "node:test";
import { apiKey } from "@better-auth/api-key";
import { betterAuth } from "better-auth";
import { apiKeyOptions } from "../../../packages/database/convex/apiKey";
import { calculateExpiresInSeconds } from "../components/dashboard/api-keys/create-api-key-dialog";

const createTestAuth = () =>
	betterAuth({
		baseURL: "http://localhost:3000",
		secret: "test-only-secret-test-only-secret-32",
		plugins: [apiKey(apiKeyOptions)],
	});

test("API key creation supports keys that never expire", async () => {
	const auth = createTestAuth();
	const key = await auth.api.createApiKey({
		body: { userId: "test-user", name: "never-expires" },
	});

	assert.equal(key.expiresAt, null);
	assert.ok(key.id);
});

test("API key creation supports a future expiration less than one day away", async () => {
	const auth = createTestAuth();
	const createdAt = Date.now();
	const key = await auth.api.createApiKey({
		body: { userId: "test-user", name: "one-hour", expiresIn: 60 * 60 },
	});

	const expiresAt = Date.parse(String(key.expiresAt));
	assert.ok(Number.isFinite(expiresAt));
	assert.ok(expiresAt >= createdAt + 59 * 60 * 1000);
	assert.ok(expiresAt <= Date.now() + 61 * 60 * 1000);
});

test("API key creation accepts the UI's 100-character name limit", async () => {
	const auth = createTestAuth();
	for (const expiresIn of [undefined, 60 * 60]) {
		const key = await auth.api.createApiKey({
			body: {
				userId: "test-user",
				name: "n".repeat(100),
				expiresIn,
			},
		});

		assert.ok(key.id);
		assert.equal(key.name?.length, 100);
	}
});

test("API key date selection rejects today and accepts tomorrow", () => {
	const today = new Date();
	const tomorrow = new Date(today);
	tomorrow.setDate(tomorrow.getDate() + 1);
	assert.equal(calculateExpiresInSeconds(today), undefined);
	const expiresIn = calculateExpiresInSeconds(tomorrow);
	assert.ok(expiresIn != null && expiresIn > 0);
});
