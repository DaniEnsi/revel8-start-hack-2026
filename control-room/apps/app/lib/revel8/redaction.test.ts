import assert from "node:assert/strict";
import test from "node:test";
import {
	formatTraceValue,
	redactTraceValue,
	traceFieldNames,
} from "./redaction";

test("historical raw events omit nested submitted values and retain outcomes", () => {
	const historical = {
		kind: "touch",
		touch_idx: 3,
		events: [
			{
				type: "page.submitted",
				fields: ["email", "password"],
				values: {
					email: "person@example.test",
					password: "not-a-real-password",
				},
				detail: {
					outcome: "incident",
					submittedValues: ["person@example.test", "not-a-real-password"],
				},
			},
		],
		outcome: "incident",
	};

	const serialized = formatTraceValue(historical, 2);
	assert.equal(serialized.includes("person@example.test"), false);
	assert.equal(serialized.includes("not-a-real-password"), false);
	assert.equal(serialized.includes("submittedValues"), false);
	assert.equal(serialized.includes('"values"'), false);
	assert.deepEqual(redactTraceValue(historical), {
		kind: "touch",
		touch_idx: 3,
		events: [
			{
				type: "page.submitted",
				fields: ["email", "password"],
				detail: { outcome: "incident" },
			},
		],
		outcome: "incident",
	});
	assert.equal(historical.events[0]?.values.email, "person@example.test");
});

test("secret variants are redacted recursively without hiding usage metadata", () => {
	const record = {
		plan: {
			api_key: "planner-secret",
			nested: [{ writerApiKey: "writer-secret", reason: "safe" }],
		},
		clientSecret: "client-secret",
		authorization: "Bearer secret",
		sessionToken: "session-secret",
		credentials: { username: "person", password: "secret" },
		tokenCount: 42,
		tokensUsed: 21,
		value: "safe-arm-metadata",
	};

	const serialized = formatTraceValue(record);
	for (const secret of [
		"planner-secret",
		"writer-secret",
		"client-secret",
		"Bearer secret",
		"session-secret",
	]) {
		assert.equal(serialized.includes(secret), false);
	}
	assert.deepEqual(redactTraceValue(record), {
		plan: { nested: [{ reason: "safe" }] },
		tokenCount: 42,
		tokensUsed: 21,
		value: "safe-arm-metadata",
	});
});

test("legacy field name/value maps render names only", () => {
	const raw = formatTraceValue({
		type: "page.submitted",
		fields: { email: "person@example.test", password: "secret" },
	});
	assert.equal(raw.includes("person@example.test"), false);
	assert.equal(raw.includes("secret"), false);
	assert.deepEqual(
		redactTraceValue({
			type: "page.submitted",
			fields: { email: "person@example.test", password: "secret" },
		}),
		{ type: "page.submitted", fields: ["email", "password"] },
	);
	assert.deepEqual(
		traceFieldNames({ email: "person@example.test", password: "secret" }),
		["email", "password"],
	);
	assert.deepEqual(
		traceFieldNames([
			"email",
			{ name: "password", value: "secret" },
			{ label: "otp", values: ["123456"] },
		]),
		["email", "password", "otp"],
	);
	assert.deepEqual(traceFieldNames({ names: ["email", "password"] }), [
		"email",
		"password",
	]);
});
