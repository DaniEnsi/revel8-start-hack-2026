"use client";

import { api } from "@x70-monorepo/database/convex/_generated/api";
import { useConvexAuth } from "convex/react";
import { Loader2, Lock, Play, Radio, ShieldCheck, Square } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
	getModelChoices,
	getSidecarBase,
	listLauncherRunning,
	type StartRunBody,
	saveModelSelection,
	setSidecarBase,
	startRun,
	stopRun,
} from "@/lib/revel8/client";
import { fmtTs, TARGETS } from "@/lib/revel8/format";
import {
	DEFAULT_MODEL_SELECTION,
	type ModelChoices,
	type ModelRole,
	type ModelSelection,
	mergeModelOptions,
} from "@/lib/revel8/model-config";
import type { RunningProc } from "@/lib/revel8/types";
import { useResilientQuery } from "@/lib/revel8/use-resilient-query";

const ARMS = {
	f2: { label: "F2 · opener", options: ["link_free", "link_in_touch_1"] },
	f5: {
		label: "F5 · Robert objective",
		options: ["credentials", "attachment_probe"],
	},
	f6: { label: "F6 · Julius referrer", options: ["soft", "named"] },
	f4: { label: "F4 · 2nd-sender probe", options: ["single", "vouch_probe"] },
} as const;

function initialModelChoices(): ModelChoices {
	return {
		selection: { ...DEFAULT_MODEL_SELECTION },
		planner: mergeModelOptions("planner", DEFAULT_MODEL_SELECTION.planner, []),
		writer: mergeModelOptions("writer", DEFAULT_MODEL_SELECTION.writer, []),
		provider: { planner: "unavailable", writer: "unavailable" },
	};
}

function Field({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) {
	return (
		<div className="flex min-w-0 flex-col gap-1.5">
			<Label className="text-xs text-muted-foreground">{label}</Label>
			{children}
		</div>
	);
}

export function ControlPanel() {
	const router = useRouter();
	const { isAuthenticated } = useConvexAuth();
	const { value: storedModels } = useResilientQuery(
		api.models.get,
		isAuthenticated ? {} : "skip",
	);
	const [form, setForm] = useState<StartRunBody>({
		target: "julius",
		arm_f2: "link_free",
		arm_f5: "credentials",
		arm_f6: "soft",
		arm_f4: "single",
		max_touches: null,
		no_live: false,
		notes: "",
		planner_model: DEFAULT_MODEL_SELECTION.planner,
		writer_model: DEFAULT_MODEL_SELECTION.writer,
	});
	const [starting, setStarting] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [running, setRunning] = useState<RunningProc[]>([]);
	const [offline, setOffline] = useState(false);
	const [sidecar, setSidecar] = useState("");
	const [modelChoices, setModelChoices] =
		useState<ModelChoices>(initialModelChoices);
	const [modelsReady, setModelsReady] = useState(false);
	const [modelsDirty, setModelsDirty] = useState(false);
	const [modelSaveState, setModelSaveState] = useState<
		"idle" | "saving" | "saved" | "error"
	>("idle");

	useEffect(() => setSidecar(getSidecarBase()), []);

	useEffect(() => {
		if (!storedModels || modelsDirty) return;
		setForm((current) => ({
			...current,
			planner_model: storedModels.planner,
			writer_model: storedModels.writer,
		}));
		setModelChoices((current) => ({
			...current,
			selection: storedModels,
		}));
	}, [storedModels, modelsDirty]);

	useEffect(() => {
		let alive = true;
		getModelChoices()
			.then((choices) => {
				if (!alive) return;
				setModelChoices(choices);
				setForm((current) => ({
					...current,
					planner_model: choices.selection.planner,
					writer_model: choices.selection.writer,
				}));
			})
			.catch(() => {
				// The configured defaults still allow an offline local launch.
			})
			.finally(() => {
				if (alive) setModelsReady(true);
			});
		return () => {
			alive = false;
		};
	}, []);

	const refresh = useCallback(async () => {
		try {
			setRunning(await listLauncherRunning());
			setOffline(false);
		} catch {
			setOffline(true);
		}
	}, []);

	useEffect(() => {
		refresh();
		const id = setInterval(refresh, 3000);
		return () => clearInterval(id);
	}, [refresh]);

	const set = <K extends keyof StartRunBody>(k: K, v: StartRunBody[K]) =>
		setForm((f) => ({ ...f, [k]: v }));

	const selection = (): ModelSelection => ({
		planner: form.planner_model,
		writer: form.writer_model,
	});

	const onModelChange = (role: ModelRole, value: string) => {
		set(role === "planner" ? "planner_model" : "writer_model", value);
		setModelsDirty(true);
		setModelSaveState("idle");
	};

	const persistModels = async (): Promise<boolean> => {
		setModelSaveState("saving");
		try {
			const saved = await saveModelSelection(selection());
			setModelChoices((current) => ({
				...current,
				selection: saved.selection,
			}));
			setModelsDirty(false);
			setModelSaveState("saved");
			return true;
		} catch {
			setModelSaveState("error");
			return false;
		}
	};

	const onStart = async () => {
		setStarting(true);
		setError(null);
		try {
			if (!(await persistModels())) {
				setError(
					"Model selection could not be saved; the run was not started.",
				);
				return;
			}
			const res = await startRun(form);
			await refresh();
			if (res.session_id) {
				router.push(`/dashboard/runs/${encodeURIComponent(res.session_id)}`);
			}
		} catch (e) {
			setError((e as Error).message);
		} finally {
			setStarting(false);
		}
	};

	return (
		<div className="flex min-w-0 flex-col gap-6">
			<div>
				<h1 className="text-xl font-semibold">Control</h1>
				<p className="text-sm text-muted-foreground">
					Configure and launch an authorized local agent run. The control-room
					bridge applies both model selections to{" "}
					<code className="font-mono text-xs">python -m agent.run</code>
					{"; "}sanitized JSONL records ingest into Convex for realtime
					monitoring.
				</p>
			</div>

			<div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-4 py-2.5 text-sm text-emerald-200">
				<ShieldCheck className="h-4 w-4 shrink-0" />
				<span>
					<b>Practice scenario only.</b> The eval scenario is refused by
					construction (runner + sidecar).
				</span>
			</div>

			{offline ? (
				<div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-200">
					Sidecar offline at <code className="font-mono">{sidecar}</code>. Start
					it (see README) to launch runs. You can point the UI at a different
					sidecar below.
				</div>
			) : null}

			<div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
				{/* config form */}
				<div className="min-w-0 rounded-lg border border-border bg-card p-4 sm:p-5">
					<div className="grid gap-4 sm:grid-cols-2">
						<Field label="Target twin">
							<Select
								value={form.target}
								onValueChange={(v) => set("target", v)}
							>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{TARGETS.map((t) => (
										<SelectItem key={t.id} value={t.id}>
											{t.label} ({t.id})
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</Field>

						<Field label="Scenario">
							<div className="flex h-10 items-center gap-2 rounded-md border border-border bg-muted/40 px-3 text-sm text-muted-foreground">
								<Lock className="h-3.5 w-3.5" /> practice (locked)
							</div>
						</Field>

						{(["planner", "writer"] as const).map((role) => (
							<Field
								key={role}
								label={role === "planner" ? "Planner model" : "Writer model"}
							>
								<Select
									value={
										role === "planner" ? form.planner_model : form.writer_model
									}
									onValueChange={(value) => onModelChange(role, value)}
									disabled={!modelsReady}
								>
									<SelectTrigger aria-label={`${role} model`}>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{modelChoices[role].map((option) => (
											<SelectItem key={option.id} value={option.id}>
												{option.label}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</Field>
						))}

						{(Object.keys(ARMS) as (keyof typeof ARMS)[]).map((arm) => {
							const key = `arm_${arm}` as keyof StartRunBody;
							return (
								<Field key={arm} label={ARMS[arm].label}>
									<Select
										value={String(form[key] ?? ARMS[arm].options[0])}
										onValueChange={(v) => set(key, v as never)}
									>
										<SelectTrigger>
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											{ARMS[arm].options.map((o) => (
												<SelectItem key={o} value={o}>
													{o}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</Field>
							);
						})}

						<Field label="Max touches (blank = full budget)">
							<Input
								type="number"
								min={1}
								max={30}
								placeholder="e.g. 8 for a smoke run"
								value={form.max_touches ?? ""}
								onChange={(e) =>
									set(
										"max_touches",
										e.target.value ? Number(e.target.value) : null,
									)
								}
							/>
						</Field>

						<div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
							<div>
								<Label className="text-sm">Live escalation</Label>
								<p className="text-[11px] text-muted-foreground">
									off = message-only (<code>--no-live</code>)
								</p>
							</div>
							<Switch
								checked={!form.no_live}
								onCheckedChange={(v) => set("no_live", !v)}
							/>
						</div>
					</div>

					<div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
						<span>
							{!modelsReady
								? "Loading model choices…"
								: modelChoices.provider.planner === "available" &&
										modelChoices.provider.writer === "available"
									? "Choices include exact IDs from the configured providers."
									: "Provider metadata unavailable; configured and saved IDs remain selectable."}
						</span>
						<Button
							variant="ghost"
							size="sm"
							className="ml-auto h-7 px-2 text-[11px]"
							disabled={
								!modelsReady || !modelsDirty || modelSaveState === "saving"
							}
							onClick={persistModels}
						>
							{modelSaveState === "saving" ? "Saving…" : "Save models"}
						</Button>
						<span aria-live="polite">
							{modelSaveState === "error"
								? "Save failed"
								: modelsDirty
									? "Unsaved model changes"
									: modelSaveState === "saved"
										? "Models saved server-side"
										: ""}
						</span>
					</div>

					<div className="mt-4">
						<Field label="Run note (optional, logged to playbook)">
							<Textarea
								rows={2}
								placeholder="What are you testing with this run?"
								value={form.notes ?? ""}
								onChange={(e) => set("notes", e.target.value)}
							/>
						</Field>
					</div>

					{error ? (
						<div className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive-foreground">
							{error}
						</div>
					) : null}

					<div className="mt-5 flex flex-wrap items-center gap-3">
						<Button
							className="shrink-0"
							onClick={onStart}
							disabled={starting || offline || !modelsReady}
						>
							{starting ? (
								<Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
							) : (
								<Play className="mr-1.5 h-4 w-4" />
							)}
							Start run
						</Button>
						<code className="min-w-0 flex-1 whitespace-pre-wrap break-all font-mono text-[11px] text-muted-foreground">
							PLANNER_MODEL={form.planner_model} WRITER_MODEL=
							{form.writer_model} python -m agent.run --target {form.target}{" "}
							--arm-f2 {form.arm_f2} --arm-f5 {form.arm_f5} --arm-f6{" "}
							{form.arm_f6}
							{form.arm_f4 !== "single" ? ` --arm-f4 ${form.arm_f4}` : ""}
							{form.max_touches ? ` --max-touches ${form.max_touches}` : ""}
							{form.no_live ? " --no-live" : ""}
						</code>
					</div>
				</div>

				{/* running + settings */}
				<div className="flex min-w-0 flex-col gap-4">
					<div className="min-w-0 rounded-lg border border-border bg-card p-4">
						<div className="mb-3 flex items-center gap-2 text-sm font-semibold">
							<Radio className="h-4 w-4 text-sky-400" /> Running now (
							{running.length})
						</div>
						{running.length ? (
							<div className="flex flex-col gap-2">
								{running.map((p) => (
									<div
										key={p.pid}
										className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/20 px-3 py-2"
									>
										<Loader2 className="h-3.5 w-3.5 animate-spin text-sky-400" />
										<div className="min-w-0 flex-1">
											<div className="truncate font-mono text-xs">
												{p.session_id ?? `pid ${p.pid}`}
											</div>
											<div className="text-[11px] text-muted-foreground">
												{p.target} · {fmtTs(p.started)}
											</div>
											{p.planner_model && p.writer_model ? (
												<div className="truncate font-mono text-[10px] text-muted-foreground">
													P {p.planner_model} · W {p.writer_model}
												</div>
											) : null}
										</div>
										<Button
											size="sm"
											variant="destructive"
											aria-label={`Stop run ${p.session_id ?? p.pid}`}
											onClick={async () => {
												if (p.session_id) await stopRun(p.session_id);
												refresh();
											}}
										>
											<Square className="h-3 w-3" />
										</Button>
									</div>
								))}
							</div>
						) : (
							<p className="text-xs text-muted-foreground">
								No runs in flight.
							</p>
						)}
					</div>

					<SidecarSettings current={sidecar} onChange={setSidecar} />
				</div>
			</div>
		</div>
	);
}

function SidecarSettings({
	current,
	onChange,
}: {
	current: string;
	onChange: (v: string) => void;
}) {
	const [value, setValue] = useState(current);
	useEffect(() => setValue(current), [current]);
	return (
		<div className="min-w-0 rounded-lg border border-border bg-card p-4">
			<Label htmlFor="sidecar-url" className="text-xs text-muted-foreground">
				Sidecar URL
			</Label>
			<div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
				<Input
					id="sidecar-url"
					type="url"
					value={value}
					onChange={(e) => setValue(e.target.value)}
					placeholder="http://localhost:8787"
					className="min-w-0 flex-1 font-mono text-xs"
				/>
				<Button
					variant="outline"
					size="sm"
					className="shrink-0"
					onClick={() => {
						setSidecarBase(value);
						onChange(value.replace(/\/$/, ""));
					}}
				>
					Save
				</Button>
			</div>
			<p className="mt-1.5 text-[11px] text-muted-foreground">
				Stored locally. Default is{" "}
				<code className="font-mono">http://localhost:8787</code>.
			</p>
		</div>
	);
}
