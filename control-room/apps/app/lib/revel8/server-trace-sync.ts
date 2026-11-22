import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { RunStatus } from "@x70-monorepo/database/convex/runStore";
import { redactTraceValue } from "./redaction";
import {
	hasPersistenceCredentials,
	type Persistence,
	persistTraceBatch,
} from "./server-convex";
import { findProjectRoot } from "./server-paths";
import type { TraceRecord } from "./types";

export interface ParsedJsonl {
	records: TraceRecord[];
	ignoredPartialLine: boolean;
}

/** Parse complete JSONL records without ever including line contents in errors. */
export function parseJsonlText(text: string): ParsedJsonl {
	const lines = text.split(/\r?\n/);
	const records: TraceRecord[] = [];
	let ignoredPartialLine = false;
	for (const [index, raw] of lines.entries()) {
		const line = raw.trim();
		if (!line) continue;
		try {
			const value: unknown = JSON.parse(line);
			if (!value || typeof value !== "object" || Array.isArray(value)) {
				throw new Error("not an object");
			}
			records.push(value as TraceRecord);
		} catch {
			if (index === lines.length - 1) ignoredPartialLine = true;
			else throw new Error(`invalid JSONL record at line ${index + 1}`);
		}
	}
	return { records, ignoredPartialLine };
}

export function traceDirectory(): string {
	return path.join(
		/*turbopackIgnore: true*/ findProjectRoot(),
		"agent",
		"traces",
	);
}

function traceFile(sessionId: string): string {
	if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(sessionId)) {
		throw new Error("invalid session id");
	}
	return path.join(traceDirectory(), `${sessionId}.jsonl`);
}

interface TraceOverrides {
	status?: RunStatus;
	plannerModel?: string;
	writerModel?: string;
}

interface IngestResult {
	inserted: number;
	unchanged: number;
	updated: number;
}

async function syncSlice(
	sessionId: string,
	offset: number,
	persistence: Persistence,
	overrides: TraceOverrides = {},
): Promise<{ nextOffset: number; result: IngestResult | null }> {
	let parsed: ParsedJsonl;
	try {
		parsed = parseJsonlText(readFileSync(traceFile(sessionId), "utf8"));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			if (!overrides.status) return { nextOffset: offset, result: null };
			const result = (await persistTraceBatch(
				{ sessionId, records: [], ...overrides },
				persistence,
			)) as IngestResult;
			return { nextOffset: offset, result };
		}
		throw error;
	}
	const recordCount = parsed.records.length;
	const safeOffset = recordCount < offset ? 0 : offset;
	const records = parsed.records
		.slice(safeOffset, safeOffset + 200)
		.map((record, index) => ({
			ordinal: safeOffset + index,
			detail: redactTraceValue(record),
		}));
	const nextOffset = safeOffset + records.length;
	if (!records.length && !overrides.status) {
		return { nextOffset, result: null };
	}
	const result = (await persistTraceBatch(
		{ sessionId, records, ...overrides },
		persistence,
	)) as IngestResult;
	return { nextOffset, result };
}

export interface TraceWatcher {
	finish: (status: RunStatus) => Promise<boolean>;
	stop: () => void;
}

const watchers = new Map<string, TraceWatcher>();

export function watchTraceSession(
	sessionId: string,
	persistence: Persistence,
	initial: TraceOverrides = {},
): TraceWatcher {
	const existing = watchers.get(sessionId);
	if (existing) return existing;
	let offset = 0;
	let stopped = false;
	let pendingInitial = initial;
	let queue: Promise<boolean> = Promise.resolve(true);
	const enqueue = (overrides: TraceOverrides = {}) => {
		queue = queue.then(async () => {
			if (stopped) return false;
			try {
				const synced = await syncSlice(sessionId, offset, persistence, {
					...pendingInitial,
					...overrides,
				});
				if (synced.result) pendingInitial = {};
				offset = synced.nextOffset;
				return true;
			} catch (error) {
				console.error(
					`[revel8] trace sync failed for ${sessionId}: ${(error as Error).message}`,
				);
				return false;
			}
		});
		return queue;
	};
	const timer = setInterval(() => void enqueue(), 500);
	const watcher: TraceWatcher = {
		finish: async (status: RunStatus) => {
			// Drain every completed JSONL batch before writing the terminal status.
			// A large final flush must not leave records behind the 200-record limit.
			let consecutiveFailures = 0;
			for (;;) {
				const previousOffset = offset;
				if (!(await enqueue())) {
					if (++consecutiveFailures >= 3) {
						watcher.stop();
						return false;
					}
					await new Promise((resolve) => setTimeout(resolve, 100));
					continue;
				}
				consecutiveFailures = 0;
				if (offset === previousOffset) break;
			}
			const synced = await enqueue({ status });
			watcher.stop();
			return synced;
		},
		stop: () => {
			stopped = true;
			clearInterval(timer);
			watchers.delete(sessionId);
		},
	};
	watchers.set(sessionId, watcher);
	void enqueue();
	return watcher;
}

export interface ImportSummary {
	sessions: number;
	inserted: number;
	unchanged: number;
	errors: Array<{ sessionId: string; detail: string }>;
}

/** Authorized historical reconciliation; safe to repeat after every restart. */
export async function importHistoricalTraces(
	persistence: Persistence,
): Promise<ImportSummary> {
	if (!hasPersistenceCredentials(persistence)) {
		throw new Error("Convex persistence credentials unavailable");
	}
	const summary: ImportSummary = {
		sessions: 0,
		inserted: 0,
		unchanged: 0,
		errors: [],
	};
	let files: string[];
	try {
		files = readdirSync(traceDirectory())
			.filter((file) => file.endsWith(".jsonl"))
			.sort();
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return summary;
		throw error;
	}
	for (const file of files) {
		const sessionId = file.slice(0, -".jsonl".length);
		try {
			let offset = 0;
			let imported = false;
			while (true) {
				const synced = await syncSlice(sessionId, offset, persistence);
				if (synced.result) {
					imported = true;
					summary.inserted += synced.result.inserted;
					summary.unchanged += synced.result.unchanged;
				}
				if (synced.nextOffset === offset) break;
				offset = synced.nextOffset;
			}
			if (imported) summary.sessions += 1;
		} catch {
			summary.errors.push({
				sessionId,
				detail: "trace could not be parsed or reconciled",
			});
		}
	}
	return summary;
}
