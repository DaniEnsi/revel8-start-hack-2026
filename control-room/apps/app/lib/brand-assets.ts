export const BRAND_CDN = "https://design.x70.one";
export const brandUrl = (path: string) => `${BRAND_CDN}${path}`;

export const brandAssets = {
	icon: brandUrl("/icon.png"),
	company: {
		headerForLightBg: brandUrl(
			"/images/transparent/logo-company-header-for-light-bg.png",
		),
		headerForDarkBg: brandUrl(
			"/images/transparent/logo-company-header-for-dark-bg.png",
		),
		wideTransparentForLightBg: brandUrl(
			"/images/transparent/x70-dark-new-4-transparent.png",
		),
		wideTransparentForDarkBg: brandUrl(
			"/images/transparent/x70-light-new-4-transparent.png",
		),
	},
	personal: {
		master: brandUrl("/images/personal/avatar.png"),
		header: brandUrl("/images/personal/avatar-header.png"),
		small: brandUrl("/images/personal/avatar-small.png"),
	},
} as const;
