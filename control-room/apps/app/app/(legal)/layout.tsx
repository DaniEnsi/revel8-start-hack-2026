import Link from "next/link";

export default function LegalLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<div className="min-h-svh bg-background px-4 py-8 text-foreground">
			<main className="mx-auto w-full max-w-2xl">
				<Link
					href="/sign-in"
					className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
				>
					← Back to sign in
				</Link>
				<article className="mt-6 rounded-xl border border-border bg-card p-5 sm:p-8">
					{children}
				</article>
			</main>
		</div>
	);
}
