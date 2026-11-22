import { SiteHeader } from "@/components/site-header";

export function PlaceholderPage({ title }: { title: string }) {
	return (
		<>
			<SiteHeader title={title} />
			<div className="flex flex-1 flex-col px-4 py-4 md:py-6 lg:px-6">
				<p className="text-base font-medium">{title}</p>
			</div>
		</>
	);
}
