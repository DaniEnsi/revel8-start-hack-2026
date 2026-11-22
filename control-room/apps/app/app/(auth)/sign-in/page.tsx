import { Suspense } from "react";
import { LoginForm } from "@/components/login-form";
import { createMetadata } from "@/lib/metadata";

export const metadata = createMetadata({
	title: "Sign In · revel8",
	description: "Sign in to the revel8 control room",
});

export default function SignInPage() {
	return (
		<Suspense fallback={null}>
			<div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-background p-6 md:p-10">
				<div className="w-full max-w-sm">
					<LoginForm />
				</div>
			</div>
		</Suspense>
	);
}
