import { existsSync } from "node:fs";
import path from "node:path";

function findUp(
	start: string,
	accept: (directory: string) => boolean,
): string | null {
	let current = path.resolve(start);
	while (true) {
		if (accept(current)) return current;
		const parent = path.dirname(current);
		if (parent === current) return null;
		current = parent;
	}
}

export function findProjectRoot(): string {
	const override = process.env.REVEL8_PROJECT_ROOT;
	if (override) {
		const resolved = path.resolve(override);
		if (
			existsSync(
				path.join(/*turbopackIgnore: true*/ resolved, "agent", "run.py"),
			)
		)
			return resolved;
		throw new Error(`REVEL8_PROJECT_ROOT has no agent/run.py: ${resolved}`);
	}
	const root = findUp(process.cwd(), (directory) =>
		existsSync(
			path.join(/*turbopackIgnore: true*/ directory, "agent", "run.py"),
		),
	);
	if (!root)
		throw new Error("Could not locate the revel8 project root (agent/run.py)");
	return root;
}

function controlRoomRoot(): string {
	const root = findUp(process.cwd(), (directory) =>
		existsSync(
			path.join(/*turbopackIgnore: true*/ directory, "pnpm-workspace.yaml"),
		),
	);
	if (!root)
		throw new Error("Could not locate the control-room workspace root");
	return root;
}

export function modelSettingsPath(): string {
	const override = process.env.REVEL8_MODEL_SETTINGS;
	if (override) return path.resolve(override);
	return path.join(controlRoomRoot(), ".revel8", "model-selection.json");
}

export function flowStateDirectory(): string {
	const override = process.env.REVEL8_FLOW_STATE_DIR;
	if (override) return path.resolve(override);
	return path.join(controlRoomRoot(), ".revel8", "flows");
}
