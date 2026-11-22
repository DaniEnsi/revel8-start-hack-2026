/**
 * revel8 dashboard — formatting helpers & shared constants.
 * Ported from the standalone viewer (dashboard/app.js) to TS. React handles
 * escaping, so these return plain values / class names rather than HTML strings.
 */

// config.py thresholds — kept in sync with agent/config.py.
export const THETA_SOFT = 0.55; // soften asks above this suspicion
export const THETA_HARD = 0.85; // stop the session above this suspicion

/** action → tailwind color classes (badge background/text/border). */
export const ACTION_CLASS: Record<string, string> = {
	probe: "bg-sky-500/15 text-sky-300 border-sky-500/30",
	build: "bg-teal-500/15 text-teal-300 border-teal-500/30",
	strike: "bg-red-500/15 text-red-300 border-red-500/30",
	forced_strike: "bg-red-500/15 text-red-300 border-red-500/30",
	push: "bg-amber-500/15 text-amber-300 border-amber-500/30",
	converse: "bg-violet-500/15 text-violet-300 border-violet-500/30",
	bail: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
};

export const REACTION_CLASS: Record<string, string> = {
	engaged: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
	wary: "bg-amber-500/15 text-amber-300 border-amber-500/30",
	ignored: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
	incident: "bg-yellow-400/20 text-yellow-300 border-yellow-400/40",
	mixed: "bg-violet-500/15 text-violet-300 border-violet-500/30",
	none: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
};

export const EVENT_CLASS: Record<string, string> = {
	reply: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
	"link.opened": "bg-sky-500/15 text-sky-300 border-sky-500/30",
	"page.submitted": "bg-yellow-400/20 text-yellow-300 border-yellow-400/40",
	"attachment.opened": "bg-violet-500/15 text-violet-300 border-violet-500/30",
};

export function badgeClass(map: Record<string, string>, key: string): string {
	return map[key] ?? "bg-zinc-500/15 text-zinc-400 border-zinc-500/30";
}

export function fmtTs(ts?: number | null): string {
	if (!ts || !isFinite(ts)) return "";
	const d = new Date(ts * 1000);
	return isNaN(d.getTime())
		? ""
		: d.toLocaleString(undefined, {
				month: "short",
				day: "numeric",
				hour: "2-digit",
				minute: "2-digit",
				second: "2-digit",
			});
}

export function fmtDur(a?: number | null, b?: number | null): string {
	if (!a || !b || b <= a) return "";
	const s = Math.round(b - a);
	return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

export function numOrNull(v: unknown): number | null {
	const n = Number(v);
	return isFinite(n) ? n : null;
}

export interface DeltaFmt {
	kind: "flat" | "up" | "down";
	text: string;
}

export function fmtDelta(d?: number | null): DeltaFmt {
	if (d == null || !isFinite(d) || Math.abs(d) < 0.005) {
		return { kind: "flat", text: "±0.00" };
	}
	return d > 0
		? { kind: "up", text: `▲ ${Math.abs(d).toFixed(2)}` }
		: { kind: "down", text: `▼ ${Math.abs(d).toFixed(2)}` };
}

/**
 * Split text into plain/URL segments so URLs can be styled (but never made
 * navigable — the lookalike pages live only inside the simulator).
 */
export interface TextSeg {
	url: boolean;
	text: string;
}

export function linkify(text: string): TextSeg[] {
	const out: TextSeg[] = [];
	const re = /(https?:\/\/[^\s)"']+)/g;
	let last = 0;
	let m: RegExpExecArray | null;
	// biome-ignore lint/suspicious/noAssignInExpressions: canonical regex-exec loop
	while ((m = re.exec(text)) !== null) {
		if (m.index > last)
			out.push({ url: false, text: text.slice(last, m.index) });
		out.push({ url: true, text: m[0] });
		last = m.index + m[0].length;
	}
	if (last < text.length) out.push({ url: false, text: text.slice(last) });
	return out;
}

export function wordCount(s?: string): number {
	return String(s ?? "")
		.split(/\s+/)
		.filter(Boolean).length;
}

export const TARGETS = [
	{ id: "julius", label: "Julius Muth" },
	{ id: "robert", label: "Robert" },
	{ id: "tom", label: "Tom" },
] as const;
