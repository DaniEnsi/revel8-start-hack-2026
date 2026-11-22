import { z } from "zod";

export const DEFAULT_MODEL_SELECTION = {
	planner: "kimi-k3.1",
	writer: "abliterated-large-v2",
} as const;

// Verified from both configured provider /models responses on 2026-11-21.
export const ABLITERATED_FLASH_MODEL_ID = "abliterated-large-flash";

export const modelIdSchema = z
	.string()
	.trim()
	.min(1)
	.max(128)
	.regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/, "invalid provider model ID");

export const modelSelectionSchema = z.object({
	planner: modelIdSchema,
	writer: modelIdSchema,
});

export type ModelSelection = z.infer<typeof modelSelectionSchema>;
export type ModelRole = keyof ModelSelection;

export interface ModelOption {
	id: string;
	label: string;
	source: "default" | "configured" | "provider" | "saved";
}

export interface ModelChoices {
	selection: ModelSelection;
	planner: ModelOption[];
	writer: ModelOption[];
	provider: Record<ModelRole, "available" | "unavailable">;
}

export function modelLabel(id: string, role: ModelRole): string {
	if (id === DEFAULT_MODEL_SELECTION[role]) return `${id} (default)`;
	if (/abliterated/i.test(id) && /flash/i.test(id)) {
		return `Abliterated Flash · ${id}`;
	}
	return id;
}

/** Defaults and verified/saved IDs stay selectable when provider discovery is offline. */
export function mergeModelOptions(
	role: ModelRole,
	selected: string,
	providerIds: string[],
): ModelOption[] {
	const ids = [
		DEFAULT_MODEL_SELECTION[role],
		ABLITERATED_FLASH_MODEL_ID,
		selected,
		...providerIds,
	].filter((id, index, all) => all.indexOf(id) === index);
	return ids.map((id) => ({
		id,
		label: modelLabel(id, role),
		source:
			id === DEFAULT_MODEL_SELECTION[role]
				? "default"
				: providerIds.includes(id)
					? "provider"
					: id === ABLITERATED_FLASH_MODEL_ID
						? "configured"
						: "saved",
	}));
}
