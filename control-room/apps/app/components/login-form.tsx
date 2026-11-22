"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn } from "@/lib/auth-client";
import { cn } from "@/lib/utils";

export function LoginForm({
	className,
	...props
}: React.ComponentPropsWithoutRef<"div">) {
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [loading, setLoading] = useState(false);
	const router = useRouter();
	const searchParams = useSearchParams();
	const callbackURL = searchParams.get("from") || "/dashboard";

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!email || !password) {
			toast.error("Please enter email and password");
			return;
		}

		await signIn.email(
			{
				email,
				password,
				callbackURL,
			},
			{
				onRequest: () => setLoading(true),
				onResponse: () => setLoading(false),
				onError: (ctx) => {
					toast.error(ctx.error.message || "Failed to sign in");
				},
				onSuccess: () => {
					toast.success("Signed in successfully");
					router.push(callbackURL);
				},
			},
		);
	};

	const handleSocialSignIn = async (
		provider: "google" | "github" | "microsoft",
	) => {
		await signIn.social({
			provider,
			callbackURL,
		});
	};

	return (
		<div className={cn("flex flex-col gap-6", className)} {...props}>
			<form onSubmit={handleSubmit}>
				<div className="flex flex-col gap-6">
					<div className="flex flex-col items-center gap-2">
						<Link
							href="/"
							className="flex flex-col items-center gap-2 font-medium"
						>
							<span className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-lg font-bold text-primary-foreground">
								r8
							</span>
							<span className="sr-only">revel8 Control Room</span>
						</Link>
						<h1 className="text-xl font-bold">Welcome back</h1>
						<div className="text-center text-sm text-muted-foreground">
							Don&apos;t have an account?{" "}
							<Link
								href="/sign-up"
								className="underline underline-offset-4 hover:text-primary"
							>
								Sign up
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
						<div className="grid gap-2">
							<Label htmlFor="password">Password</Label>
							<Input
								id="password"
								name="password"
								type="password"
								placeholder="••••••••"
								autoComplete="current-password"
								required
								value={password}
								onChange={(e) => setPassword(e.target.value)}
							/>
							<div className="flex justify-end">
								<Link
									href="/forget-password"
									className="text-sm underline underline-offset-4 hover:text-primary"
								>
									Forgot password?
								</Link>
							</div>
						</div>
						<Button type="submit" className="w-full" disabled={loading}>
							{loading ? (
								<Loader2 className="size-4 animate-spin" />
							) : (
								"Sign in"
							)}
						</Button>
					</div>
				</div>
			</form>
			<div className="relative text-center text-sm after:absolute after:inset-0 after:top-1/2 after:z-0 after:flex after:items-center after:border-t after:border-border">
				<span className="relative z-10 bg-background px-2 text-muted-foreground">
					Or continue with
				</span>
			</div>
			<div className="grid gap-3 sm:grid-cols-2">
				<Button
					type="button"
					variant="outline"
					className="w-full gap-2"
					onClick={() => handleSocialSignIn("google")}
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 24 24"
						className="size-4"
						aria-hidden
					>
						<path
							d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z"
							fill="currentColor"
						/>
					</svg>
					Google
				</Button>
				<Button
					type="button"
					variant="outline"
					className="w-full gap-2"
					onClick={() => handleSocialSignIn("github")}
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 24 24"
						className="size-4"
						aria-hidden
					>
						<path
							fill="currentColor"
							d="M12 2A10 10 0 0 0 2 12c0 4.42 2.87 8.17 6.84 9.5c.5.08.66-.23.66-.5v-1.69c-2.77.6-3.36-1.34-3.36-1.34c-.46-1.16-1.11-1.47-1.11-1.47c-.91-.62.07-.6.07-.6c1 .07 1.53 1.03 1.53 1.03c.87 1.52 2.34 1.07 2.91.83c.09-.65.35-1.09.63-1.34c-2.22-.25-4.55-1.11-4.55-4.92c0-1.11.38-2 1.03-2.71c-.1-.25-.45-1.29.1-2.64c0 0 .84-.27 2.75 1.02c.79-.22 1.65-.33 2.5-.33s1.71.11 2.5.33c1.91-1.29 2.75-1.02 2.75-1.02c.55 1.35.2 2.39.1 2.64c.65.71 1.03 1.6 1.03 2.71c0 3.82-2.34 4.66-4.57 4.91c.36.31.69.92.69 1.85V21c0 .27.16.59.67.5C19.14 20.16 22 16.42 22 12A10 10 0 0 0 12 2"
						/>
					</svg>
					GitHub
				</Button>
			</div>
			<p className="text-balance text-center text-xs text-muted-foreground [&_a]:underline [&_a]:underline-offset-4 hover:[&_a]:text-primary">
				By signing in, you agree to our{" "}
				<Link href="/terms">Terms of Service</Link> and{" "}
				<Link href="/privacy">Privacy Policy</Link>.
			</p>
		</div>
	);
}
