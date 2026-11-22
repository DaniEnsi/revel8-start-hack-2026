import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import path from "node:path";
import { z } from "zod";
import { serviceMutation, serviceSecret } from "./server-convex";
import {
	type Launcher,
	launcherSchema,
	launcherStateSchema,
} from "./server-launcher";
import { modelSettingsPath } from "./server-paths";

function directory() {
	return path.join(path.dirname(modelSettingsPath()), "launchers");
}

export function launcherFolder(id: string) {
	return path.join(directory(), id);
}

function readJson(file: string): unknown {
	try {
		return JSON.parse(readFileSync(file, "utf8"));
	} catch {
		return null;
	}
}

export function readLauncherState(id: string) {
	return launcherStateSchema.safeParse(
		readJson(path.join(launcherFolder(id), "state.json")),
	).data;
}

export function journalLauncher(launcher: Launcher) {
	const folder = launcherFolder(launcher.id);
	mkdirSync(folder, { mode: 0o700, recursive: true });
	const file = path.join(folder, "launcher.json");
	const temporary = `${file}.${process.pid}.tmp`;
	writeFileSync(temporary, JSON.stringify(launcher), { mode: 0o600 });
	renameSync(temporary, file);
}

export function forgetLauncher(id: string) {
	rmSync(launcherFolder(id), { recursive: true, force: true });
}

export async function saveLauncher(launcher: Launcher) {
	if (serviceSecret()) await serviceMutation("launchers", { launcher });
}

const pageSchema = z.object({
	page: z.array(launcherSchema),
	isDone: z.boolean(),
	continueCursor: z.string(),
});

export async function loadLaunchers(): Promise<Launcher[]> {
	const launchers = new Map<string, Launcher>();
	// Keep the journal until both the final trace and Convex launcher status are written.
	const folder = directory();
	const entries = existsSync(folder)
		? readdirSync(folder, { withFileTypes: true })
		: [];
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const result = launcherSchema.safeParse(
			readJson(path.join(folder, entry.name, "launcher.json")),
		);
		if (result.success && result.data.id === entry.name)
			launchers.set(entry.name, result.data);
	}
	if (serviceSecret()) {
		try {
			let cursor: string | null = null;
			for (;;) {
				const result = pageSchema.parse(
					await serviceMutation("launchers", { cursor }),
				);
				for (const launcher of result.page) {
					if (!launchers.has(launcher.id)) launchers.set(launcher.id, launcher);
				}
				if (result.isDone) break;
				cursor = result.continueCursor;
			}
		} catch (error) {
			console.error("[revel8] loading launchers from Convex failed", error);
		}
	}
	return [...launchers.values()];
}
