import { z } from "zod";

export const AddressSchema = z.object({
	street: z.string().optional(),
	city: z.string().min(1, "City is required"),
	state: z.string().optional(),
	postalCode: z.string().optional(),
	country: z.string().min(1, "Country is required"),
});

export const SocialLinksSchema = z.object({
	twitter: z.string().url().optional(),
	github: z.string().url().optional(),
	linkedin: z.string().url().optional(),
	website: z.string().url().optional(),
});

export const UserPreferencesSchema = z.object({
	theme: z.enum(["light", "dark", "system"]).default("system"),
	language: z.string().default("en"),
	timezone: z.string().default("UTC"),
	marketingEmails: z.boolean().default(false),
	securityEmails: z.boolean().default(true),
});

export const ProfileSchema = z.object({
	id: z.string().optional(),
	userId: z.string(),
	firstName: z.string().min(1, "First name is required"),
	lastName: z.string().min(1, "Last name is required"),
	email: z.string().email("Invalid email address"),
	phone: z.string().optional(),
	avatarUrl: z.string().url().optional(),
	bio: z.string().max(500, "Bio must be under 500 characters").optional(),
	location: AddressSchema.optional(),
	socialLinks: SocialLinksSchema.optional(),
	preferences: UserPreferencesSchema.default({}),
	createdAt: z.string().optional(),
	updatedAt: z.string().optional(),
});

export type Address = z.infer<typeof AddressSchema>;
export type SocialLinks = z.infer<typeof SocialLinksSchema>;
export type UserPreferences = z.infer<typeof UserPreferencesSchema>;
export type Profile = z.infer<typeof ProfileSchema>;
