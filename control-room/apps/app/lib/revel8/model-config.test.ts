import assert from "node:assert/strict";
import test from "node:test";
import { POST as launchRun } from "../../app/api/revel8/runs/route";
import {
	DEFAULT_MODEL_SELECTION,
	mergeModelOptions,
	modelSelectionSchema,
} from "./model-config";
import { buildAgentArgs, startRunInputSchema } from "./server-runner";

test("required model defaults are unchanged", () => {
	assert.deepEqual(DEFAULT_MODEL_SELECTION, {
		planner: "kimi-k3.1",
		writer: "abliterated-large-v2",
	});
	const input = startRunInputSchema.parse({ target: "julius" });
	assert.equal(input.planner_model, "kimi-k3.1");
	assert.equal(input.writer_model, "abliterated-large-v2");
	assert.equal(input.arm_f2, "link_free");
	assert.equal(input.arm_f4, "single");
	assert.equal(input.arm_f5, "credentials");
	assert.equal(input.arm_f6, "soft");
});

test("provider IDs supplement defaults and saved selections without duplicates", () => {
	const options = mergeModelOptions("planner", "saved-planner", [
		"kimi-k3.1",
		"saved-planner",
		"another-planner",
	]);
	assert.deepEqual(
		options.map((option) => option.id),
		[
			"kimi-k3.1",
			"abliterated-large-flash",
			"saved-planner",
			"another-planner",
		],
	);
	assert.deepEqual(
		options.map((option) => option.source),
		["default", "configured", "provider", "provider"],
	);
});

test("Abliterated Flash uses the verified configured ID, never a guessed alias", () => {
	const withoutProvider = mergeModelOptions(
		"writer",
		DEFAULT_MODEL_SELECTION.writer,
		[],
	);
	assert.equal(
		withoutProvider.some((option) => option.id === "abliterated-large-flash"),
		true,
	);
	assert.equal(
		withoutProvider.some((option) => option.id === "abliterated-flash"),
		false,
	);
	assert.equal(DEFAULT_MODEL_SELECTION.writer, "abliterated-large-v2");
	const withProvider = mergeModelOptions(
		"writer",
		DEFAULT_MODEL_SELECTION.writer,
		["abliterated-large-flash"],
	);
	assert.equal(
		withProvider.filter((option) => option.id === "abliterated-large-flash")
			.length,
		1,
	);
	assert.equal(
		withProvider.find((option) => option.id === "abliterated-large-flash")
			?.source,
		"provider",
	);
});

test("run validation is practice-locked and rejects malformed selections", () => {
	assert.equal(
		startRunInputSchema.safeParse({ target: "eval" }).success,
		false,
	);
	assert.equal(
		startRunInputSchema.safeParse({ target: "julius", scenario: "eval" })
			.success,
		false,
	);
	assert.equal(
		startRunInputSchema.safeParse({ target: "julius", max_touches: 0 }).success,
		false,
	);
	assert.equal(
		modelSelectionSchema.safeParse({ planner: "bad model", writer: "ok" })
			.success,
		false,
	);
});

test("argv preserves run controls and never interpolates model IDs", () => {
	const input = startRunInputSchema.parse({
		target: "robert",
		arm_f5: "attachment_probe",
		max_touches: 3,
		no_live: true,
		notes: "local smoke; no shell",
		planner_model: "planner-test",
		writer_model: "writer-test",
	});
	const args = buildAgentArgs(input);
	assert.deepEqual(args.slice(0, 6), [
		"-m",
		"agent.run",
		"--target",
		"robert",
		"--scenario",
		"practice",
	]);
	assert.ok(args.includes("--no-live"));
	assert.ok(args.includes("attachment_probe"));
	assert.ok(args.includes("local smoke; no shell"));
	assert.equal(args.includes("planner-test"), false);
	assert.equal(args.includes("writer-test"), false);
});

test("launch API rejects malformed JSON before spawning", async () => {
	const response = await launchRun(
		new Request("http://localhost/api/revel8/runs", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "{",
		}),
	);
	assert.equal(response.status, 400);
	assert.deepEqual(await response.json(), { detail: "invalid JSON body" });
});
