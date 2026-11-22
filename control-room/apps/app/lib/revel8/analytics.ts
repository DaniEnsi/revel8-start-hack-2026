/**
 * revel8 dashboard — cross-session analytics.
 * Descriptive proxy metrics for practice and trace analysis. Official eval
 * scoring uses a selected three-session cohort in scoring.ts.
 */

import type { Session } from "./types";

export interface Aggregate {
	totalSessions: number;
	incidents: number;
	incidentRate: number; // 0..1
	avgTouchesToIncident: number | null;
	avgFinalSuspicion: number | null;
	perTarget: PerTargetRow[];
	armOutcomes: ArmRow[];
	suspicionCurves: SuspicionCurve[];
	channelUsage: { channel: string; count: number }[];
}

export interface PerTargetRow {
	target: string;
	sessions: number;
	incidents: number;
	incidentRate: number;
	avgTouchesToIncident: number | null;
	avgFinalSuspicion: number | null;
}

export interface ArmRow {
	arm: string; // e.g. "f2"
	value: string; // e.g. "link_free"
	sessions: number;
	incidents: number;
	incidentRate: number;
	avgTouchesToIncident: number | null;
}

export interface SuspicionCurve {
	sessionId: string;
	target: string;
	outcome: string;
	points: { touch: number; suspicion: number }[];
}

function mean(xs: number[]): number | null {
	const v = xs.filter((x) => isFinite(x));
	return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

function isIncident(s: Session): boolean {
	return s.meta.outcome === "incident" || s.meta.incidentTouch != null;
}

function touchesToIncident(s: Session): number | null {
	if (!isIncident(s)) return null;
	return s.meta.incidentTouch ?? s.meta.touchesUsed ?? null;
}

export function aggregate(sessions: Session[]): Aggregate {
	const total = sessions.length;
	const incidentSessions = sessions.filter(isIncident);
	const ttis = sessions
		.map(touchesToIncident)
		.filter((x): x is number => x != null);
	const finals = sessions
		.map((s) => s.meta.finalSuspicion)
		.filter((x): x is number => x != null);

	// per-target
	const targets = [...new Set(sessions.map((s) => s.meta.target || "unknown"))];
	const perTarget: PerTargetRow[] = targets.map((target) => {
		const rows = sessions.filter(
			(s) => (s.meta.target || "unknown") === target,
		);
		const inc = rows.filter(isIncident);
		const t = rows.map(touchesToIncident).filter((x): x is number => x != null);
		return {
			target,
			sessions: rows.length,
			incidents: inc.length,
			incidentRate: rows.length ? inc.length / rows.length : 0,
			avgTouchesToIncident: mean(t),
			avgFinalSuspicion: mean(
				rows
					.map((s) => s.meta.finalSuspicion)
					.filter((x): x is number => x != null),
			),
		};
	});

	// arm outcomes (f2/f4/f5/f6 × value)
	const armMap = new Map<string, Session[]>();
	for (const s of sessions) {
		const arms = s.meta.arms;
		if (!arms) continue;
		for (const [arm, value] of Object.entries(arms)) {
			const key = `${arm}::${value}`;
			if (!armMap.has(key)) armMap.set(key, []);
			armMap.get(key)!.push(s);
		}
	}
	const armOutcomes: ArmRow[] = [...armMap.entries()]
		.map(([key, rows]) => {
			const [arm, value] = key.split("::");
			const inc = rows.filter(isIncident);
			const t = rows
				.map(touchesToIncident)
				.filter((x): x is number => x != null);
			return {
				arm,
				value,
				sessions: rows.length,
				incidents: inc.length,
				incidentRate: rows.length ? inc.length / rows.length : 0,
				avgTouchesToIncident: mean(t),
			};
		})
		.sort((a, b) =>
			a.arm === b.arm
				? a.value.localeCompare(b.value)
				: a.arm.localeCompare(b.arm),
		);

	// suspicion curves
	const suspicionCurves: SuspicionCurve[] = sessions.map((s) => ({
		sessionId: s.id,
		target: s.meta.target,
		outcome: s.meta.outcome,
		points: s.touches
			.map((t) => ({ touch: t.idx ?? 0, suspicion: t.suspicion ?? 0 }))
			.filter((p) => isFinite(p.suspicion)),
	}));

	// channel usage
	const chanCount = new Map<string, number>();
	for (const s of sessions) {
		for (const t of s.touches) {
			if (!t.channel) continue;
			chanCount.set(t.channel, (chanCount.get(t.channel) ?? 0) + 1);
		}
	}
	const channelUsage = [...chanCount.entries()]
		.map(([channel, count]) => ({ channel, count }))
		.sort((a, b) => b.count - a.count);

	return {
		totalSessions: total,
		incidents: incidentSessions.length,
		incidentRate: total ? incidentSessions.length / total : 0,
		avgTouchesToIncident: mean(ttis),
		avgFinalSuspicion: mean(finals),
		perTarget,
		armOutcomes,
		suspicionCurves,
		channelUsage,
	};
}
