import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";
import { createMetadata } from "@/lib/metadata";

export const metadata = createMetadata({
	title: "Sign Up · revel8",
	description: "Create a revel8 control-room account",
});

export default function SignUpPage() {
	return <OnboardingWizard />;
}
