"use client";

import { useState } from "react";
import {
	BestTeamContacts,
	RubricBreakdown,
	RubricFields,
	speedLabel,
} from "@/components/revel8/scoring-worksheet";
import {
	illustrativeAssumptions,
	rubricPresets,
	scoreRubricDemo,
} from "@/lib/revel8/rubric-demo";
import type { RubricInputs } from "@/lib/revel8/scoring";

export function RubricDemo() {
	const [preset, setPreset] = useState<keyof typeof rubricPresets>("A");
	const [bestTeamContacts, setBestTeamContacts] = useState<number | undefined>(
		1,
	);
	const [assumptions, setAssumptions] = useState<RubricInputs | null>(null);
	const { incidentCount, medianSpeed, points } = scoreRubricDemo(preset, {
		...assumptions,
		bestTeamContacts,
	});

	return (
		<section
			aria-labelledby="rubric-demo-title"
			className="space-y-4 rounded-lg border border-border bg-card p-4"
		>
			<div>
				<h2 id="rubric-demo-title" className="text-sm font-semibold">
					What-if rubric demo
				</h2>
				<p className="text-sm text-muted-foreground">
					Hypothetical calculations only. Practice traces carry no official
					score. Session <code>s_34f935573e</code> is an example of a practice
					run without an incident.
				</p>
			</div>
			<fieldset className="flex flex-wrap gap-3">
				<legend className="mb-2 text-sm font-medium">
					First-incident contacts by run
				</legend>
				{(["A", "B", "C"] satisfies (keyof typeof rubricPresets)[]).map(
					(key) => {
						const { label, touches } = rubricPresets[key];
						return (
							<label
								key={key}
								className="flex items-center gap-2 rounded-lg border border-input px-3 py-2 text-sm"
							>
								<input
									type="radio"
									name="rubric-demo-preset"
									value={key}
									checked={preset === key}
									onChange={() => setPreset(key)}
								/>
								<span>
									{key} · {label} [
									{touches.map((touch) => touch ?? "miss").join(", ")}]
								</span>
							</label>
						);
					},
				)}
			</fieldset>
			<p aria-live="polite" className="text-sm font-medium">
				{incidentCount} of 3 runs reached an incident · Median first incident ·{" "}
				{speedLabel(medianSpeed)}
			</p>
			<BestTeamContacts initial={1} onChange={setBestTeamContacts} />
			<label className="flex items-center gap-2 text-sm">
				<input
					type="checkbox"
					checked={assumptions !== null}
					onChange={(event) =>
						setAssumptions(
							event.target.checked ? illustrativeAssumptions : null,
						)
					}
				/>
				Include illustrative assumptions for targeting, craft, and jury points
			</label>
			{assumptions !== null && (
				<fieldset className="space-y-2">
					<legend className="mb-2 text-sm font-medium">
						Illustrative inputs
					</legend>
					<RubricFields
						initial={illustrativeAssumptions}
						onChange={(change) =>
							setAssumptions((current) => ({ ...current, ...change }))
						}
					/>
				</fieldset>
			)}
			<RubricBreakdown points={points} hypothetical />
		</section>
	);
}
