import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
	fetchProviderModelIds,
	getModelChoices,
	loadModelSelection,
	saveModelSelection,
} from "./server-models";

async function listen(server: ReturnType<typeof createServer>) {
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("no test port");
	return `http://127.0.0.1:${address.port}`;
}

test("model selection persists server-side and reloads exactly", (t) => {
	const directory = mkdtempSync(path.join(tmpdir(), "revel8-model-settings-"));
	const previous = process.env.REVEL8_MODEL_SETTINGS;
	process.env.REVEL8_MODEL_SETTINGS = path.join(directory, "selection.json");
	t.after(() => {
		if (previous === undefined) delete process.env.REVEL8_MODEL_SETTINGS;
		else process.env.REVEL8_MODEL_SETTINGS = previous;
		rmSync(directory, { recursive: true, force: true });
	});
	assert.deepEqual(loadModelSelection(), {
		planner: "kimi-k3.1",
		writer: "abliterated-large-v2",
	});
	saveModelSelection({ planner: "planner-saved", writer: "writer-saved" });
	assert.deepEqual(loadModelSelection(), {
		planner: "planner-saved",
		writer: "writer-saved",
	});
	assert.deepEqual(
		JSON.parse(readFileSync(process.env.REVEL8_MODEL_SETTINGS, "utf8")),
		{
			planner: "planner-saved",
			writer: "writer-saved",
		},
	);
});

test("provider discovery uses exact metadata IDs for both roles", async (t) => {
	const directory = mkdtempSync(path.join(tmpdir(), "revel8-provider-test-"));
	const keys = [
		"REVEL8_MODEL_SETTINGS",
		"PLANNER_BASE_URL",
		"WRITER_BASE_URL",
		"PLANNER_API_KEY",
		"WRITER_API_KEY",
	] as const;
	const previous = Object.fromEntries(
		keys.map((key) => [key, process.env[key]]),
	);
	const authorizations: string[] = [];
	const server = createServer((request, response) => {
		authorizations.push(request.headers.authorization ?? "");
		response.setHeader("content-type", "application/json");
		response.end(
			JSON.stringify({
				data: [
					{ id: "abliterated-flash-exact-id" },
					{ id: "kimi-k3.1" },
					{ id: "abliterated-large-v2" },
					{ id: "not a valid id" },
				],
			}),
		);
	});
	const baseUrl = await listen(server);
	process.env.REVEL8_MODEL_SETTINGS = path.join(directory, "selection.json");
	process.env.PLANNER_BASE_URL = `${baseUrl}/v1`;
	process.env.WRITER_BASE_URL = `${baseUrl}/v1`;
	process.env.PLANNER_API_KEY = "local-test-key";
	process.env.WRITER_API_KEY = "local-test-key";
	t.after(async () => {
		for (const key of keys) {
			const value = previous[key];
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		await new Promise<void>((resolve, reject) =>
			server.close((error) => (error ? reject(error) : resolve())),
		);
		rmSync(directory, { recursive: true, force: true });
	});

	assert.deepEqual(await fetchProviderModelIds("planner"), [
		"abliterated-flash-exact-id",
		"abliterated-large-v2",
		"kimi-k3.1",
	]);
	const choices = await getModelChoices();
	assert.deepEqual(choices.provider, {
		planner: "available",
		writer: "available",
	});
	assert.ok(
		choices.writer.some(
			(option) =>
				option.id === "abliterated-flash-exact-id" &&
				option.source === "provider",
		),
	);
	assert.deepEqual(authorizations, [
		"Bearer local-test-key",
		"Bearer local-test-key",
		"Bearer local-test-key",
	]);
});
