/**
 * revel8 dashboard — authenticated launcher and sidecar fallback client.
 *
 * Convex subscriptions are the primary run/trace read path. The sidecar
 * (revel8/sidecar/app.py, FastAPI) supplies legacy JSONL reads and process
 * controls. The same-origin Next.js bridge owns model-aware launches, process
 * state, and Convex ingestion. Static samples remain the final offline fallback.
 */

import type { ModelChoices, ModelSelection } from "./model-config";
import type { Playbook, RunListItem, RunningProc, TraceRecord } from "./types";

const DEFAULT_BASE = "http://localhost:8787";
const LS_KEY = "revel8.sidecar.base";

export function getSidecarBase(): string {
	if (typeof window !== "undefined") {
		try {
			const override = window.localStorage.getItem(LS_KEY);
			if (override) return override.replace(/\/$/, "");
		} catch {
			/* private mode / blocked storage */
		}
	}
	const env = process.env.NEXT_PUBLIC_REVEL8_SIDECAR;
	return (env || DEFAULT_BASE).replace(/\/$/, "");
}

export function setSidecarBase(base: string): void {
	try {
		window.localStorage.setItem(LS_KEY, base.replace(/\/$/, ""));
	} catch {
		/* ignore */
	}
}

export function wsBase(): string {
	return getSidecarBase().replace(/^http/, "ws");
}

async function requestJSON<T>(url: string, init?: RequestInit): Promise<T> {
	const res = await fetch(url, {
		...init,
		headers: { "content-type": "application/json", ...(init?.headers || {}) },
	});
	if (!res.ok) {
		let detail = `${res.status} ${res.statusText}`;
		try {
			const body = await res.json();
			if (body?.detail) detail = String(body.detail);
		} catch {
			/* ignore */
		}
		throw new Error(detail);
	}
	return (await res.json()) as T;
}

function getJSON<T>(path: string, init?: RequestInit): Promise<T> {
	return requestJSON(`${getSidecarBase()}${path}`, init);
}

function launcherJSON<T>(path: string, init?: RequestInit): Promise<T> {
	return requestJSON(`/api/revel8${path}`, init);
}

export async function health(): Promise<{
	ok: boolean;
	agent_dir: string;
	traces_dir: string;
}> {
	return getJSON("/api/health");
}

export async function listRuns(): Promise<RunListItem[]> {
	const [data, launcherRuns] = await Promise.all([
		getJSON<{ runs: RunListItem[] }>("/api/runs"),
		listLauncherRunning().catch(() => []),
	]);
	const launcherSessions = new Set(
		launcherRuns.flatMap((run) => (run.session_id ? [run.session_id] : [])),
	);
	return (data.runs ?? []).map((run) => ({
		...run,
		running: run.running || launcherSessions.has(run.session_id),
	}));
}

export function getRun(
	session: string,
): Promise<{ session_id: string; records: TraceRecord[]; running: boolean }> {
	return getJSON(`/api/runs/${encodeURIComponent(session)}`);
}

export async function getPlaybook(): Promise<Playbook | null> {
	try {
		return await getJSON<Playbook>("/api/playbook");
	} catch {
		return null;
	}
}

export interface StartRunBody {
	target: string;
	arm_f2?: string;
	arm_f4?: string;
	arm_f5?: string;
	arm_f6?: string;
	max_touches?: number | null;
	no_live?: boolean;
	notes?: string;
	planner_model: string;
	writer_model: string;
}

export function startRun(body: StartRunBody): Promise<RunningProc> {
	return launcherJSON("/runs", { method: "POST", body: JSON.stringify(body) });
}

export async function stopRun(session: string): Promise<{ stopped: boolean }> {
	try {
		const result = await launcherJSON<{ stopped: boolean }>(
			`/runs/${encodeURIComponent(session)}/stop`,
			{ method: "POST" },
		);
		if (result.stopped) return result;
	} catch {
		// Fall through for legacy runs started directly by the FastAPI sidecar.
	}
	return getJSON(`/api/runs/${encodeURIComponent(session)}/stop`, {
		method: "POST",
	});
}

export function listLauncherRunning(): Promise<RunningProc[]> {
	return launcherJSON<{ running: RunningProc[] }>("/running").then(
		(data) => data.running ?? [],
	);
}

export async function listRunning(): Promise<RunningProc[]> {
	const [sidecar, launcher] = await Promise.all([
		getJSON<{ running: RunningProc[] }>("/api/running"),
		listLauncherRunning(),
	]);
	const seen = new Set<string>();
	return [...launcher, ...(sidecar.running ?? [])].filter((run) => {
		const key = run.session_id ? `session:${run.session_id}` : `pid:${run.pid}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

export function getModelChoices(): Promise<ModelChoices> {
	return launcherJSON<ModelChoices>("/models");
}

export function saveModelSelection(
	selection: ModelSelection,
): Promise<{ selection: ModelSelection }> {
	return launcherJSON("/models", {
		method: "PUT",
		body: JSON.stringify(selection),
	});
}

/* ------------------------------------------------------------- websocket */

export type WsMessage =
	| { type: "snapshot"; records: TraceRecord[]; running: boolean }
	| { type: "record"; record: TraceRecord }
	| { type: "status"; running: boolean; outcome?: string }
	| { type: "runs"; runs: RunListItem[] }
	| { type: "error"; detail: string };

/**
 * Subscribe to a session's live tail. Returns a disposer. Auto-reconnects with
 * backoff until disposed. onOpen/onClose let the UI show live/offline state.
 */
export function subscribeSession(
	session: string,
	handlers: {
		onMessage: (m: WsMessage) => void;
		onOpen?: () => void;
		onClose?: () => void;
	},
): () => void {
	let ws: WebSocket | null = null;
	let closed = false;
	let retry = 0;
	let timer: ReturnType<typeof setTimeout> | null = null;

	const connect = () => {
		if (closed) return;
		try {
			ws = new WebSocket(`${wsBase()}/ws/runs/${encodeURIComponent(session)}`);
		} catch {
			scheduleReconnect();
			return;
		}
		ws.onopen = () => {
			retry = 0;
			handlers.onOpen?.();
		};
		ws.onmessage = (ev) => {
			try {
				handlers.onMessage(JSON.parse(ev.data) as WsMessage);
			} catch {
				/* ignore malformed frame */
			}
		};
		ws.onclose = () => {
			handlers.onClose?.();
			scheduleReconnect();
		};
		ws.onerror = () => {
			try {
				ws?.close();
			} catch {
				/* ignore */
			}
		};
	};

	const scheduleReconnect = () => {
		if (closed) return;
		retry = Math.min(retry + 1, 6);
		const delay = Math.min(1000 * 2 ** retry, 15000);
		timer = setTimeout(connect, delay);
	};

	connect();

	return () => {
		closed = true;
		if (timer) clearTimeout(timer);
		try {
			ws?.close();
		} catch {
			/* ignore */
		}
	};
}
