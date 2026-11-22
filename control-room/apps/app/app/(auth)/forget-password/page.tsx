import { ForgotPasswordForm } from "@/components/forgot-password-form";
import { createMetadata } from "@/lib/metadata";

export const metadata = createMetadata({
	title: "Forgot Password · Portal",
	description: "Reset your x70 Portal account password",
});

export default function ForgotPasswordPage() {
	return (
		<div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-background p-6 md:p-10">
			<div className="w-full max-w-sm">
				<ForgotPasswordForm />
			</div>
		</div>
	);
}
