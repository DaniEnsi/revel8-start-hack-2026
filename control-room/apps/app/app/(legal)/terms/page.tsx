import { createMetadata } from "@/lib/metadata";

export const metadata = createMetadata({
	title: "Terms of Service · revel8",
	description: "Terms for using the revel8 control room",
});

export default function TermsPage() {
	return (
		<>
			<h1 className="text-2xl font-semibold">Terms of Service</h1>
			<p className="mt-2 text-sm text-muted-foreground">
				These terms apply to the revel8 hackathon control-room demonstration.
			</p>
			<div className="mt-6 space-y-5 text-sm leading-6">
				<section>
					<h2 className="font-semibold">Authorized practice use only</h2>
					<p className="mt-1 text-muted-foreground">
						Use the agent only with the built-in, consenting practice twins and
						local test services. Do not point it at production accounts, real
						people, or third-party systems without explicit authorization.
					</p>
				</section>
				<section>
					<h2 className="font-semibold">Safe operation</h2>
					<p className="mt-1 text-muted-foreground">
						Do not enter real credentials or sensitive personal information into
						a practice scenario. You are responsible for how you configure and
						operate your local deployment and for protecting its account keys.
					</p>
				</section>
				<section>
					<h2 className="font-semibold">Demonstration software</h2>
					<p className="mt-1 text-muted-foreground">
						This demonstration is provided as-is, without a service-level or
						fitness guarantee. Trace interpretations are analytical displays,
						not security decisions or assessments of real people.
					</p>
				</section>
			</div>
		</>
	);
}
