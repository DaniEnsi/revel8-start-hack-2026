/**
 * Primary dashboard navigation. The left sidebar is the only place these
 * links render; the top header carries page context and status, never links.
 */
export type Revel8NavKey =
	| "overview"
	| "runs"
	| "control"
	| "analytics"
	| "account"
	| "api-keys";

export interface Revel8NavItem {
	key: Revel8NavKey;
	href: string;
	label: string;
	/** Match only this exact path, not its sub-routes. */
	exact: boolean;
}

export const REVEL8_NAV: readonly Revel8NavItem[] = [
	{ key: "overview", href: "/dashboard", label: "Overview", exact: true },
	{ key: "runs", href: "/dashboard/runs", label: "Runs", exact: false },
	{
		key: "control",
		href: "/dashboard/control",
		label: "Control",
		exact: false,
	},
	{
		key: "analytics",
		href: "/dashboard/analytics",
		label: "Analytics",
		exact: false,
	},
	{ key: "account", href: "/dashboard/account", label: "Account", exact: true },
	{
		key: "api-keys",
		href: "/dashboard/account/api-keys",
		label: "API Keys",
		exact: false,
	},
];

function normalize(pathname: string): string {
	return pathname.length > 1 && pathname.endsWith("/")
		? pathname.slice(0, -1)
		: pathname;
}

export function isRevel8NavActive(
	pathname: string,
	item: Revel8NavItem,
): boolean {
	const path = normalize(pathname);
	if (path === item.href) return true;
	return !item.exact && path.startsWith(`${item.href}/`);
}

/** The nav item the current path belongs to, used for the header title. */
export function activeRevel8NavItem(
	pathname: string,
): Revel8NavItem | undefined {
	return REVEL8_NAV.find((item) => isRevel8NavActive(pathname, item));
}
