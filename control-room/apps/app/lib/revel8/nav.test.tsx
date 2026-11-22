import assert from "node:assert/strict";
import test from "node:test";
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { Revel8Sidebar } from "@/components/dashboard/sidebar";
import { Revel8Shell } from "@/components/revel8/shell";
import { SidebarProvider } from "@/components/ui/sidebar";
import { activeRevel8NavItem, isRevel8NavActive, REVEL8_NAV } from "./nav";

const EXPECTED = [
	["Overview", "/dashboard"],
	["Runs", "/dashboard/runs"],
	["Control", "/dashboard/control"],
	["Analytics", "/dashboard/analytics"],
	["Account", "/dashboard/account"],
	["API Keys", "/dashboard/account/api-keys"],
] as const;

function renderLayout(pathname: string): string {
	return renderToStaticMarkup(
		<PathnameContext.Provider value={pathname}>
			<SidebarProvider defaultOpen>
				<Revel8Sidebar />
				<div className="min-w-0 flex-1">
					<Revel8Shell>
						<p>page body</p>
					</Revel8Shell>
				</div>
			</SidebarProvider>
		</PathnameContext.Provider>,
	);
}

function navLinks(
	html: string,
): { href: string; label: string; current: boolean }[] {
	const navStart = html.indexOf('<nav aria-label="Dashboard navigation"');
	assert.ok(navStart >= 0, "sidebar renders a labelled nav landmark");
	const nav = html.slice(navStart, html.indexOf("</nav>", navStart));
	return [...nav.matchAll(/<a([^>]*)>([\s\S]*?)<\/a>/g)].map((m) => ({
		href: /href="([^"]+)"/.exec(m[1])?.[1] ?? "",
		label: m[2].replace(/<[^>]+>/g, ""),
		current: m[1].includes('aria-current="page"'),
	}));
}

test("nav config lists the six dashboard destinations in order", () => {
	assert.deepEqual(
		REVEL8_NAV.map((item) => [item.label, item.href]),
		EXPECTED,
	);
});

test("active state matches exact routes and sub-routes on segment boundaries", () => {
	const active = (p: string) =>
		REVEL8_NAV.filter((item) => isRevel8NavActive(p, item)).map((i) => i.label);
	assert.deepEqual(active("/dashboard"), ["Overview"]);
	assert.deepEqual(active("/dashboard/"), ["Overview"]);
	assert.deepEqual(active("/dashboard/runs/abc123"), ["Runs"]);
	assert.deepEqual(active("/dashboard/account"), ["Account"]);
	assert.deepEqual(active("/dashboard/account/api-keys"), ["API Keys"]);
	assert.deepEqual(active("/dashboard/runsheet"), []);
	assert.equal(activeRevel8NavItem("/dashboard/control")?.label, "Control");
});

test("left sidebar renders identity, every nav link, and the practice-only label", () => {
	const html = renderLayout("/dashboard/runs/abc");
	assert.match(html, /data-sidebar="sidebar"/);
	assert.match(html, /data-side="left"/);
	assert.match(html, /data-collapsible="icon"|data-state="expanded"/);
	assert.match(html, />revel8</);
	assert.match(html, />control room</);
	assert.match(html, /Authorized CTF · practice only/);

	const links = navLinks(html);
	assert.deepEqual(
		links.map((l) => [l.label, l.href]),
		EXPECTED,
	);
	assert.deepEqual(
		links.filter((l) => l.current).map((l) => l.label),
		["Runs"],
	);
});

test("top header has no duplicate primary nav links, only a sidebar toggle", () => {
	const html = renderLayout("/dashboard/analytics");
	const headerStart = html.indexOf("<header");
	const header = html.slice(
		headerStart,
		html.indexOf("</header>", headerStart),
	);
	assert.ok(headerStart >= 0, "shell renders a top header");
	assert.doesNotMatch(header, /<nav\b/);
	assert.doesNotMatch(header, /<a\b/);
	assert.match(header, /aria-label="Collapse sidebar"/);
	assert.match(header, /aria-expanded="true"/);
	assert.match(header, />Analytics</);

	// Exactly one element on the page links to each dashboard route as nav.
	assert.equal(html.match(/<nav\b/g)?.length, 1);
	for (const [, href] of EXPECTED.slice(1)) {
		assert.equal(
			html.split(`href="${href}"`).length - 1,
			1,
			`${href} linked once`,
		);
	}
});

test("collapsed desktop state labels the toggle as expand", () => {
	const html = renderToStaticMarkup(
		<PathnameContext.Provider value="/dashboard">
			<SidebarProvider defaultOpen={false}>
				<Revel8Sidebar />
				<Revel8Shell>x</Revel8Shell>
			</SidebarProvider>
		</PathnameContext.Provider>,
	);
	assert.match(html, /data-state="collapsed"/);
	assert.match(html, /data-collapsible="icon"/);
	assert.match(html, /aria-label="Expand sidebar"/);
	assert.match(html, /aria-expanded="false"/);
});
