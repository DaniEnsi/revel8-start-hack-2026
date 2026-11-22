import { createMetadata } from "@/lib/metadata";

export const metadata = createMetadata({
	title: "Privacy Policy · revel8",
	description: "Privacy information for the revel8 control room",
});

export default function PrivacyPage() {
	return (
		<>
			<h1 className="text-2xl font-semibold">Privacy Policy</h1>
			<p className="mt-2 text-sm text-muted-foreground">
				Privacy information for the revel8 hackathon control-room demonstration.
			</p>
			<div className="mt-6 space-y-5 text-sm leading-6">
				<section>
					<h2 className="font-semibold">Account and session data</h2>
					<p className="mt-1 text-muted-foreground">
						The configured authentication service processes account details,
						credentials, sessions, and API keys needed to sign you in. The
						deployment operator controls that service and its retention.
					</p>
				</section>
				<section>
					<h2 className="font-semibold">Practice traces</h2>
					<p className="mt-1 text-muted-foreground">
						Run records are redacted before display and persistence. Submitted
						field values and recognized secret-bearing fields are omitted;
						non-sensitive outcome and timing metadata remains so runs can be
						replayed and aggregated. Use only synthetic practice data.
					</p>
				</section>
				<section>
					<h2 className="font-semibold">Local preferences and providers</h2>
					<p className="mt-1 text-muted-foreground">
						The browser stores interface preferences such as the sidecar URL and
						sidebar state. Any configured authentication, model, or analytics
						providers process data under the operator&apos;s configuration and
						their own policies.
					</p>
				</section>
			</div>
		</>
	);
}
