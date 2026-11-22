/**
 * revel8 dashboard — trace & playbook types.
 *
 * The agent's trace format (agent/trace.py, D-Q) is tolerant by design: field
 * names drift while the loop evolves, so these types are intentionally loose and
 * every reader in `trace.ts` falls back across the known shapes. Do not tighten
 * these without updating the getters.
 */

export type TraceRecord = Record<string, unknown> & {
	kind?: string;
	ts?: number;
	touch_idx?: number;
};

export interface Sender {
	name?: string;
	role?: string;
	org?: string;
	address?: string;
	domain?: string;
}

export interface TopicBelief {
	confidence?: number;
	status?: string; // untested | engaged | cold
}

export interface WriterBrief {
	goal?: string;
	angle?: string;
	tone?: string;
	key_points?: string[];
	asserted_facts?: string[];
	cta?: string;
}

export interface LandingPage {
	url?: string;
	title?: string;
	fields?: string[];
	html?: string;
}

export interface GuardReadback {
	pass?: boolean;
	severity?: string;
	issues?: string[];
}

export interface GuardResult {
	passed?: boolean;
	issues?: string[];
	redos?: number;
	readback?: GuardReadback;
	history?: Array<{
		attempt?: number;
		pass?: boolean;
		severity?: string;
		issues?: string[];
	}>;
}

export interface NormEvent {
	type: string;
	text: string;
	url: string;
	fields: string[] | null;
	file: string;
	channel: string;
	raw: unknown;
}

/** A normalised touch, independent of which trace shape produced it. */
export interface Touch {
	idx: number | null;
	action: string;
	channel: string;
	topicId: string;
	topicLabel: string;
	reason: string;
	sender: Sender | null;
	suspicion: number | null;
	touchesLeft: number | null;
	topics: Record<string, TopicBelief> | null;
	brief: WriterBrief | null;
	draft: Record<string, unknown>;
	guard: GuardResult | GuardResult["issues"] | null;
	events: unknown[];
	reaction: string;
	fallbacks: unknown[];
	objective: string;
	target: string;
	ts: number | null;
	raw: TraceRecord;
}

export type RowType = "touch" | "marker";

export interface Row {
	type: RowType;
	rec: TraceRecord;
	t?: Touch;
	kind?: string;
}

export interface SessionMeta {
	target: string;
	targetName: string;
	scenario: string;
	arms: Record<string, string> | null;
	objective: string;
	budget: number | null;
	outcome: string; // incident | in progress | ended...
	incidentTouch: number | null;
	incidentVia: string | null;
	touchesUsed: number;
	finalSuspicion: number | null;
	channels: string[];
	persona: Sender | null;
	startTs: number | null;
	endTs: number | null;
	endReason: string;
}

export interface Session {
	id: string;
	name: string;
	rows: Row[];
	touches: Touch[];
	meta: SessionMeta;
}

/* ------------------------------------------------------------- playbook */

export interface PlaybookTargetEntry {
	learned_hook?: {
		topic_id?: string;
		label?: string;
		confidence?: number;
	} | null;
	winning_identity?: Sender | null;
	winning_channel?: string | null;
	reached_incident?: {
		objective?: string;
		touches_to_incident?: number;
		via?: string;
	} | null;
	safe_facts?: string[];
	traps_hit?: string[];
	burned_senders?: string[];
	suspicion_triggering_lines?: string[];
}

export interface PlaybookSessionRow {
	session_id?: string;
	target_id?: string;
	outcome?: string;
	touches_used?: number;
	incident?: unknown;
	final_suspicion?: number;
	notes?: string;
	ts?: number;
}

export interface Playbook {
	version?: number;
	per_target?: Record<string, PlaybookTargetEntry>;
	sessions?: PlaybookSessionRow[];
}

/* ------------------------------------------------------------- sidecar API */

export interface RunListItem {
	session_id: string;
	file: string;
	size: number;
	mtime: number;
	running: boolean;
	status?: string;
	meta: Partial<SessionMeta> & { target?: string };
}

export interface RunningProc {
	session_id: string | null;
	pid: number;
	started: number;
	args: string[];
	target: string;
	planner_model?: string;
	writer_model?: string;
}
