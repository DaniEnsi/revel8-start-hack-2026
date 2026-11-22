interface SiteHeaderProps {
	title: string;
}

/**
 * In-page title bar. Navigation and the sidebar toggle live in the dashboard
 * shell, so this renders only the heading.
 */
export function SiteHeader({ title }: SiteHeaderProps) {
	return (
		<header className="flex h-12 shrink-0 items-center border-b bg-background">
			<div className="flex w-full items-center px-4 lg:px-6">
				<h1 className="text-base font-medium">{title}</h1>
			</div>
		</header>
	);
}
