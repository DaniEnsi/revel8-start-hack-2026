export interface TeamInvite {
	id: string;
	email: string;
	role: "admin" | "member";
}

export interface OnboardingData {
	firstName: string;
	lastName: string;
	email: string;
	password: string;
	avatar: string | null;
	workspaceName: string;
	workspaceSlug: string;
	workspaceLogo: string | null;
	linkedGoogle: boolean;
	linkedGithub: boolean;
	invites: TeamInvite[];
}

export const ONBOARDING_STEPS = [
	{
		id: 1,
		title: "Set up your profile",
		description: "Add your details to personalize your account.",
	},
	{
		id: 2,
		title: "Configure your workspace",
		description: "Name your business and set your portal URL.",
	},
	{
		id: 3,
		title: "Connect your accounts",
		description: "Link Google or GitHub to enable social login.",
	},
	{
		id: 4,
		title: "Invite your team",
		description: "Add colleagues to collaborate with you.",
	},
] as const;

export const initialOnboardingData: OnboardingData = {
	firstName: "",
	lastName: "",
	email: "",
	password: "",
	avatar: null,
	workspaceName: "",
	workspaceSlug: "",
	workspaceLogo: null,
	linkedGoogle: false,
	linkedGithub: false,
	invites: [{ id: "invite-1", email: "", role: "member" }],
};
