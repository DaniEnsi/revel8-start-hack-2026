import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { auth } from "@/lib/auth";
import { OrganizationCard } from "./organization-card";
import UserCardClient from "./UserCardClient";

export default async function AccountPage() {
	const [session, activeSessions, _deviceSessions, organization] =
		await Promise.all([
			auth.api.getSession({ headers: await headers() }),
			auth.api.listSessions({ headers: await headers() }),
			auth.api.listDeviceSessions({ headers: await headers() }),
			auth.api.getFullOrganization({ headers: await headers() }),
		]).catch(() => {
			redirect("/sign-in");
		});

	return (
		<>
			<SiteHeader title="Account" />
			<div className="flex w-full min-w-0 max-w-full flex-col space-y-4 p-3 sm:p-4 [&>*]:min-w-0 [&_.w-max]:w-full [&_.w-max]:max-w-full [&_.w-max_.flex]:flex-wrap [&_p]:break-words">
				<UserCardClient
					session={JSON.parse(JSON.stringify(session))}
					activeSessions={JSON.parse(JSON.stringify(activeSessions))}
				/>
				<OrganizationCard
					session={JSON.parse(JSON.stringify(session))}
					activeOrganization={JSON.parse(JSON.stringify(organization))}
				/>
			</div>
		</>
	);
}
