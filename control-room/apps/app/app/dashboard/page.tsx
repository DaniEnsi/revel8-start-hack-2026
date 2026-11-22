import { BarChart3, Play, Radio, ShieldCheck, Sparkles } from "lucide-react";
import Link from "next/link";

const CARDS = [
	{
		href: "/dashboard/runs",
		icon: Play,
		title: "Runs",
		body: "Sanitized Convex traces rendered turn-by-turn, with JSONL fallback. Live runs update in place; finished runs replay with scrub + play.",
	},
	{
		href: "/dashboard/control",
		icon: Radio,
		title: "Control",
		body: "Configure autonomous runs or versioned ordered flows. Next.js launches the practice CLI and streams sanitized checkpoints and traces into Convex.",
	},
	{
		href: "/dashboard/analytics",
		icon: BarChart3,
		title: "Analytics",
		body: "Incident rate, contacts-to-incident, per-twin breakdown, suspicion curves, and A/B arm outcomes across all sessions.",
	},
];

export default function Revel8Overview() {
	return (
		<div className="flex flex-col gap-8">
			<section className="rounded-xl border border-border bg-gradient-to-b from-card to-background p-8">
				<div className="flex items-center gap-2 text-xs font-medium text-emerald-400">
					<ShieldCheck className="h-4 w-4" /> Authorized security-awareness CTF
					· practice only
				</div>
				<h1 className="mt-3 text-3xl font-semibold tracking-tight">
					Agentic Social Engineer — control room
				</h1>
				<p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
					Launch, monitor, and replay the revel8 agent's runs against the
					consenting practice twins. Watch each touch unfold live — the message
					as the twin sees it, the registered landing page, the events that came
					back, and the agent's inferred suspicion and topic beliefs — or scrub
					a finished session frame by frame.
				</p>
				<div className="mt-5 flex flex-wrap gap-3">
					<Link
						href="/dashboard/runs"
						className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
					>
						<Play className="h-4 w-4" /> Browse runs
					</Link>
					<Link
						href="/dashboard/runs/sample"
						className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-secondary"
					>
						<Sparkles className="h-4 w-4" /> Open the sample replay
					</Link>
					<Link
						href="/dashboard/control"
						className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-medium hover:bg-secondary"
					>
						<Radio className="h-4 w-4" /> Start a run
					</Link>
				</div>
			</section>

			<section className="grid gap-4 md:grid-cols-3">
				{CARDS.map((c) => {
					const Icon = c.icon;
					return (
						<Link
							key={c.href}
							href={c.href}
							className="group rounded-xl border border-border bg-card p-5 transition-colors hover:border-foreground/30"
						>
							<Icon className="h-5 w-5 text-muted-foreground group-hover:text-foreground" />
							<h2 className="mt-3 font-semibold">{c.title}</h2>
							<p className="mt-1 text-sm text-muted-foreground">{c.body}</p>
						</Link>
					);
				})}
			</section>

			<section className="rounded-xl border border-border bg-card p-6">
				<h2 className="text-sm font-semibold">How it connects</h2>
				<p className="mt-2 text-sm leading-relaxed text-muted-foreground">
					A same-origin Next.js bridge starts and stops{" "}
					<code className="font-mono text-xs">python -m agent.run</code> and{" "}
					<code className="font-mono text-xs">python -m agent.flow_run</code> in
					practice-locked modes. It redacts and reconciles their JSONL records,
					flow checkpoints, and model selections into Convex. Authenticated
					Convex subscriptions drive the live run cards, replay, analytics, and
					flow-step monitor; process state remains separate because Convex
					cannot inspect child processes. The FastAPI sidecar and JSONL files
					remain compatibility fallbacks, with a bundled sample for an
					empty/offline replay. Models stay on their configured providers;
					nothing about them is hosted here.
				</p>
			</section>
		</div>
	);
}
