"use client";

import { ArrowLeft, CheckCircle2, Loader2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

export function ForgotPasswordForm({
	className,
	...props
}: React.ComponentPropsWithoutRef<"div">) {
	const [email, setEmail] = useState("");
	const [loading, setLoading] = useState(false);
	const [isSubmitted, setIsSubmitted] = useState(false);

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!email) {
			toast.error("Please enter your email");
			return;
		}

		setLoading(true);
		try {
			await authClient.forgetPassword({
				email,
				redirectTo: "/reset-password",
			});
			setIsSubmitted(true);
		} catch {
			toast.error("An error occurred. Please try again.");
		} finally {
			setLoading(false);
		}
	};

	if (isSubmitted) {
		return (
			<div className={cn("flex flex-col gap-6", className)} {...props}>
				<div className="flex flex-col items-center gap-2">
					<Link
						href="/"
						className="flex flex-col items-center gap-2 font-medium"
					>
						<Logo className="h-8" />
						<span className="sr-only">x70 Portal</span>
					</Link>
					<h1 className="text-xl font-bold">Check your email</h1>
					<p className="text-center text-sm text-muted-foreground">
						We&apos;ve sent a password reset link to{" "}
						<span className="font-medium text-foreground">{email}</span>.
					</p>
				</div>
				<div className="flex items-start gap-3 rounded-lg border border-border bg-muted/40 p-4 text-sm">
					<CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
					<p className="text-muted-foreground">
						If you don&apos;t see the email within a few minutes, check your
						spam folder.
					</p>
				</div>
				<Button
					variant="outline"
					className="w-full"
					onClick={() => setIsSubmitted(false)}
				>
					<ArrowLeft className="size-4" />
					Try a different email
				</Button>
				<div className="text-center text-sm text-muted-foreground">
					<Link
						href="/sign-in"
						className="underline underline-offset-4 hover:text-primary"
					>
						Back to sign in
					</Link>
				</div>
			</div>
		);
	}

	return (
		<div className={cn("flex flex-col gap-6", className)} {...props}>
			<form onSubmit={handleSubmit}>
				<div className="flex flex-col gap-6">
					<div className="flex flex-col items-center gap-2">
						<Link
							href="/"
							className="flex flex-col items-center gap-2 font-medium"
						>
							<Logo className="h-8" />
							<span className="sr-only">x70 Portal</span>
						</Link>
						<h1 className="text-xl font-bold">Forgot password</h1>
						<div className="text-center text-sm text-muted-foreground">
							Remember your password?{" "}
							<Link
								href="/sign-in"
								className="underline underline-offset-4 hover:text-primary"
							>
								Sign in
							</Link>
						</div>
					</div>
					<div className="flex flex-col gap-4">
						<div className="grid gap-2">
							<Label htmlFor="email">Email</Label>
							<Input
								id="email"
								name="email"
								type="email"
								placeholder="m@example.com"
								autoComplete="email"
								required
								value={email}
								onChange={(e) => setEmail(e.target.value)}
							/>
						</div>
						<Button type="submit" className="w-full" disabled={loading}>
							{loading ? (
								<Loader2 className="size-4 animate-spin" />
							) : (
								"Send reset link"
							)}
						</Button>
					</div>
				</div>
			</form>
			<p className="text-balance text-center text-xs text-muted-foreground [&_a]:underline [&_a]:underline-offset-4 hover:[&_a]:text-primary">
				By continuing, you agree to our{" "}
				<Link href="/terms">Terms of Service</Link> and{" "}
				<Link href="/privacy">Privacy Policy</Link>.
			</p>
		</div>
	);
}
