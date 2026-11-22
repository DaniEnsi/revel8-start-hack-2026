"use client";

import { useState } from "react";
import { Label } from "@/components/ui/label";
import {
	isEvalSession,
	type RubricInputs,
	type Speed,
	scoreEvalCohort,
	scoreRubric,
} from "@/lib/revel8/scoring";
import type { Session } from "@/lib/revel8/types";

export function speedLabel(speed: Speed): string {
	switch (speed.kind) {
		case "reached":
			return `${speed.touch} ${speed.touch === 1 ? "touch" : "touches"}`;
		case "not-reached":
			return "Not reached";
		case "missing":
			return "Missing";
	}
}

const sessionSlots = ["first", "second", "third"];

const inputClass =
	"h-9 w-full min-w-0 rounded-lg border border-input bg-background px-3 text-sm";

export function ScoringWorksheet({
	sessions,
}: {
	sessions: readonly Session[];
}) {
	const [selected, setSelected] = useState<string[]>(
		sessionSlots.map(() => ""),
	);
	const evalSessions = sessions.filter(isEvalSession);
	const selectedSessions = selected.flatMap((id) =>
		sessions.filter((session) => session.id === id),
	);
	const result = scoreEvalCohort(selectedSessions);

	return (
		<section
			aria-labelledby="eval-scoring-title"
			className="space-y-4 rounded-lg border border-border bg-card p-4"
		>
			<div>
				<h2 id="eval-scoring-title" className="text-sm font-semibold">
					Official eval scoring worksheet
				</h2>
				<p className="text-sm text-muted-foreground">
					Select three completed 10-touch eval sessions with distinct targets.
					Use organizer-confirmed runs and enter the cohort benchmarks, ratings,
					and jury points below.
				</p>
			</div>
			{evalSessions.length === 0 ? (
				<p className="text-sm text-muted-foreground">
					No eval traces available. Import the scoring-session JSONL from Runs.
				</p>
			) : (
				<div className="grid gap-3 sm:grid-cols-3">
					{sessionSlots.map((slot, index) => (
						<div key={slot} className="grid min-w-0 gap-1.5">
							<Label htmlFor={`eval-session-${slot}`}>
								Eval session {index + 1}
							</Label>
							<select
								id={`eval-session-${slot}`}
								className={inputClass}
								value={selected[index]}
								onChange={(event) =>
									setSelected(
										selected.map((value, position) =>
											position === index ? event.target.value : value,
										),
									)
								}
							>
								<option value="">Select a session</option>
								{evalSessions.map((session) => (
									<option
										key={session.id}
										value={session.id}
										disabled={selected.some(
											(id, position) => position !== index && id === session.id,
										)}
									>
										{(typeof session.meta.target === "string" &&
											session.meta.target.trim()) ||
											"Unknown target"}{" "}
										· {session.id}
									</option>
								))}
							</select>
						</div>
					))}
				</div>
			)}

			{result.rows.length > 0 && (
				<div className="overflow-x-auto">
					<table className="w-full text-left text-sm [&_td]:py-2 [&_td]:pr-4 [&_th]:pb-2 [&_th]:pr-4">
						<caption className="sr-only">
							Trace evidence by eval session
						</caption>
						<thead className="border-b text-muted-foreground">
							<tr>
								<th scope="col">Target</th>
								<th scope="col">Touches</th>
								<th scope="col">Incident (trace)</th>
								<th scope="col">First incident</th>
							</tr>
						</thead>
						<tbody>
							{[
								...new Map(
									result.rows.map((row) => [row.sessionId, row]),
								).values(),
							].map((row) => (
								<tr key={row.sessionId} className="border-b">
									<th scope="row" className="font-medium">
										{row.target || "Unknown"}
									</th>
									<td>
										{row.touches == null ? "Missing" : `${row.touches}/10`}
									</td>
									<td>
										{row.incident == null
											? "Unknown"
											: row.incident
												? "Reached"
												: "Not reached"}
									</td>
									<td>{speedLabel(row.speed)}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}

			{evalSessions.length > 0 && (
				<div aria-live="polite" className="space-y-1 text-sm">
					{result.issues.length ? (
						<ul className="list-inside list-disc text-muted-foreground">
							{[...new Set(result.issues)].map((issue) => (
								<li key={issue}>{issue}</li>
							))}
						</ul>
					) : (
						<p className="text-muted-foreground">
							Trace evidence · {result.incidentCount} of 3 reached an incident
							{result.medianSpeed &&
								` · Median first incident: ${speedLabel(result.medianSpeed)}`}
						</p>
					)}
				</div>
			)}
			<OfficialRubric
				key={JSON.stringify([...selected].sort())}
				incidentCount={result.incidentCount}
				medianSpeed={result.medianSpeed}
			/>
			<p className="text-xs text-muted-foreground">
				Ignored messages count. A whole call counts as one touch. Use the
				organizer’s median hit share across the three runs, including contacts
				from qualifying own-angle runs as hits. Inputs apply to the current
				selection and reset when the cohort changes or the page reloads.
			</p>
		</section>
	);
}

function OfficialRubric({
	incidentCount,
	medianSpeed,
}: Pick<ReturnType<typeof scoreEvalCohort>, "incidentCount" | "medianSpeed">) {
	const [inputs, setInputs] = useState<RubricInputs>({});
	const points = scoreRubric({ incidentCount, medianSpeed, inputs });
	return (
		<>
			<fieldset className="space-y-3">
				<legend className="mb-2 text-sm font-semibold">Organizer inputs</legend>
				<BestTeamContacts
					onChange={(value) =>
						setInputs((current) => ({ ...current, bestTeamContacts: value }))
					}
				/>
				<RubricFields
					onChange={(change) =>
						setInputs((current) => ({ ...current, ...change }))
					}
				/>
			</fieldset>
			<RubricBreakdown points={points} />
		</>
	);
}

function numberValue(value: string): number | undefined {
	return value === "" ? undefined : Number(value);
}

export function BestTeamContacts({
	initial,
	onChange,
}: {
	initial?: number;
	onChange: (value: number | undefined) => void;
}) {
	return (
		<label className="grid max-w-xs gap-1.5 text-sm">
			Best team contacts
			<input
				className={inputClass}
				type="number"
				min={1}
				max={10}
				defaultValue={initial}
				onChange={(event) => onChange(numberValue(event.target.value))}
			/>
		</label>
	);
}

const numericFields = [
	{ key: "medianRunHitShare", label: "Median run hit share (0–1)", max: 1 },
	{ key: "bestTeamTopicShare", label: "Best team topic share (>0–1)", max: 1 },
	{ key: "wrongFactsDeduction", label: "Wrong-facts deduction (0–5)", max: 5 },
	{ key: "craftMedianRating", label: "Craft median rating (0 if none sent)" },
	{ key: "craftRatingMaximum", label: "Craft rating scale maximum (>0)" },
	{ key: "architecture", label: "Architecture points (0–40)", max: 40 },
	{ key: "pitch", label: "Pitch points (0–15)", max: 15 },
] satisfies {
	key: keyof Omit<RubricInputs, "qualifyingOwnAngle" | "bestTeamContacts">;
	label: string;
	max?: number;
}[];

export function RubricFields({
	initial = {},
	onChange,
}: {
	initial?: RubricInputs;
	onChange: (change: RubricInputs) => void;
}) {
	return (
		<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
			{numericFields.map((field) => (
				<label key={field.key} className="grid gap-1.5 text-sm">
					{field.label}
					<input
						type="number"
						min={0}
						max={"max" in field ? field.max : undefined}
						step="any"
						className={inputClass}
						defaultValue={initial[field.key]}
						onChange={(event) =>
							onChange({ [field.key]: numberValue(event.target.value) })
						}
					/>
				</label>
			))}
			<label className="grid gap-1.5 text-sm">
				Qualifying own-angle incident
				<select
					className={inputClass}
					defaultValue={
						initial.qualifyingOwnAngle === undefined
							? ""
							: String(initial.qualifyingOwnAngle)
					}
					onChange={(event) =>
						onChange({
							qualifyingOwnAngle:
								event.target.value === ""
									? undefined
									: event.target.value === "true",
						})
					}
				>
					<option value="">Pending</option>
					<option value="true">Yes</option>
					<option value="false">No</option>
				</select>
			</label>
		</div>
	);
}

export function RubricBreakdown({
	points,
	hypothetical = false,
}: {
	points: ReturnType<typeof scoreRubric>;
	hypothetical?: boolean;
}) {
	const rows = [
		{
			component: "Incidents",
			formula: "20 × incident runs ÷ 3",
			value: points.incidents,
		},
		{
			component: "Speed",
			formula: "5 × best team contacts ÷ median contacts (0 if Not reached)",
			value: points.speed,
		},
		{
			component: "Results / 25",
			formula: "Incidents + speed",
			value: points.results,
			subtotal: true,
		},
		{
			component: "Their topic",
			formula: "6 × median run hit share ÷ best team topic share",
			value: points.topic,
		},
		{
			component: "Own angle",
			formula: "+4 for a qualifying own-angle incident",
			value: points.ownAngle,
		},
		{
			component: "Targeting / 10",
			formula: "Their topic + own angle",
			value: points.targeting,
			subtotal: true,
		},
		{
			component: "Wrong facts",
			formula: "Subtract 0–5 jury points",
			value: points.deduction ? -points.deduction : points.deduction,
		},
		{
			component: "Craft / 10",
			formula: "10 × median rating ÷ rating scale maximum",
			value: points.craft,
		},
		{
			component: "Architecture / 40",
			formula: "Jury score",
			value: points.architecture,
		},
		{ component: "Pitch / 15", formula: "Jury score", value: points.pitch },
		{
			component: hypothetical
				? "Hypothetical total / 100"
				: "Rubric total / 100",
			formula: "Results + targeting + craft + architecture + pitch − deduction",
			value: points.total,
			subtotal: true,
		},
	];
	const formatPoints = new Intl.NumberFormat("en", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 3,
	});
	return (
		<div className="overflow-x-auto" aria-live="polite">
			<table className="w-full text-left text-sm [&_td]:py-2 [&_td]:pr-4 [&_th]:py-2 [&_th]:pr-4">
				<caption className="sr-only">
					{hypothetical
						? "Hypothetical rubric breakdown"
						: "Eval rubric breakdown"}
				</caption>
				<thead className="border-b text-muted-foreground">
					<tr>
						<th scope="col">Component</th>
						<th scope="col">Formula</th>
						<th scope="col">Points</th>
					</tr>
				</thead>
				<tbody>
					{rows.map(({ component, formula, value, subtotal }) => (
						<tr
							key={component}
							className={
								subtotal ? "border-b bg-muted/50 font-semibold" : "border-b"
							}
						>
							<th scope="row" className="font-medium">
								{component}
							</th>
							<td className="text-muted-foreground">{formula}</td>
							<td className="tabular-nums">
								{value === null ? "Pending" : formatPoints.format(value)}
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}
