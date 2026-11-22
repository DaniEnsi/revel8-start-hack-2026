import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import {
	DEFAULT_MODEL_SELECTION,
	type ModelChoices,
	type ModelRole,
	type ModelSelection,
	mergeModelOptions,
	modelSelectionSchema,
} from "./model-config";
import { findProjectRoot, modelSettingsPath } from "./server-paths";

const providerResponseSchema = z.object({
	data: z.array(z.object({ id: z.string() })),
});

function readDotenv(): Record<string, string> {
	try {
		const text = readFileSync(
			path.join(/*turbopackIgnore: true*/ findProjectRoot(), ".env"),
			"utf8",
		);
		const values: Record<string, string> = {};
		for (const rawLine of text.split(/\r?\n/)) {
			const line = rawLine.trim();
			if (!line || line.startsWith("#")) continue;
			const separator = line.indexOf("=");
			if (separator < 1) continue;
			const key = line.slice(0, separator).trim();
			const value = line
				.slice(separator + 1)
				.trim()
				.replace(/^(['"])(.*)\1$/, "$2");
			values[key] = value;
		}
		return values;
	} catch {
		return {};
	}
}

function providerConfig(role: ModelRole): { baseUrl: string; apiKey: string } {
	const dotenv = readDotenv();
	const prefix = role.toUpperCase();
	const get = (key: string) => process.env[key] || dotenv[key] || "";
	const baseUrl = (get(`${prefix}_BASE_URL`) || get("WRITER_BASE_URL")).replace(
		/\/$/,
		"",
	);
	return {
		baseUrl,
		apiKey: get(`${prefix}_API_KEY`) || get("WRITER_API_KEY") || "sk-noauth",
	};
}

/** Returns exact IDs supplied by the configured OpenAI-compatible provider. */
export async function fetchProviderModelIds(
	role: ModelRole,
): Promise<string[] | null> {
	const { baseUrl, apiKey } = providerConfig(role);
	if (!baseUrl) return null;
	try {
		const url = new URL(`${baseUrl}/models`);
		if (url.protocol !== "http:" && url.protocol !== "https:") return null;
		const response = await fetch(url, {
			headers: {
				Authorization: `Bearer ${apiKey}`,
				Accept: "application/json",
			},
			cache: "no-store",
			signal: AbortSignal.timeout(5000),
		});
		if (!response.ok) return null;
		const parsed = providerResponseSchema.safeParse(await response.json());
		if (!parsed.success) return null;
		return [
			...new Set(
				parsed.data.data
					.map((model) => model.id.trim())
					.filter((id) => /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(id)),
			),
		].sort((a, b) => a.localeCompare(b));
	} catch {
		return null;
	}
}

export function loadModelSelection(): ModelSelection {
	try {
		const parsed = modelSelectionSchema.safeParse(
			JSON.parse(readFileSync(modelSettingsPath(), "utf8")),
		);
		if (parsed.success) return parsed.data;
	} catch {
		// Missing or invalid local state falls back to the configured defaults.
	}
	return { ...DEFAULT_MODEL_SELECTION };
}

export function saveModelSelection(selection: ModelSelection): ModelSelection {
	const valid = modelSelectionSchema.parse(selection);
	const file = modelSettingsPath();
	mkdirSync(path.dirname(file), { recursive: true });
	const temporary = `${file}.${process.pid}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(valid, null, 2)}\n`, {
		encoding: "utf8",
		mode: 0o600,
	});
	renameSync(temporary, file);
	return valid;
}

export async function getModelChoices(
	selection: ModelSelection = loadModelSelection(),
): Promise<ModelChoices> {
	const [plannerIds, writerIds] = await Promise.all([
		fetchProviderModelIds("planner"),
		fetchProviderModelIds("writer"),
	]);
	return {
		selection,
		planner: mergeModelOptions("planner", selection.planner, plannerIds ?? []),
		writer: mergeModelOptions("writer", selection.writer, writerIds ?? []),
		provider: {
			planner: plannerIds ? "available" : "unavailable",
			writer: writerIds ? "available" : "unavailable",
		},
	};
}
