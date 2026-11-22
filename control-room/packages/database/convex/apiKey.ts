import type {
	ApiKeyConfigurationOptions,
	ApiKeyOptions,
} from "@better-auth/api-key";

export const apiKeyOptions = {
	enableMetadata: true,
	enableSessionForAPIKeys: false,
	// Keep the server limit aligned with the account form's maxLength.
	maximumNameLength: 100,
	keyExpiration: {
		defaultExpiresIn: null,
		// The account UI supports any future date, including less than one day away.
		minExpiresIn: 0,
	},
} satisfies ApiKeyConfigurationOptions & ApiKeyOptions;
