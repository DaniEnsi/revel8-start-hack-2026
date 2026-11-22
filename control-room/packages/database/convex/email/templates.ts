export function getVerificationEmailHtml(url: string): string {
	return `
	<!DOCTYPE html>
	<html>
	<head>
		<meta charset="utf-8">
		<title>Verify your email address</title>
		<style>
			body { font-family: sans-serif; background-color: #ffffff; padding: 20px; }
			.container { border: 1px solid #eaeaea; border-radius: 4px; padding: 20px; max-width: 465px; margin: 40px auto; }
			h1 { color: #000000; font-size: 24px; font-weight: normal; text-align: center; margin: 30px 0; }
			p { font-size: 14px; line-height: 24px; color: #000000; }
			.btn-container { text-align: center; margin: 32px 0; }
			.btn { background-color: #000000; border-radius: 4px; color: #ffffff !important; font-size: 12px; font-weight: 600; text-decoration: none; padding: 12px 20px; display: inline-block; }
			hr { border: 0; border-top: 1px solid #eaeaea; margin: 26px 0; }
		</style>
	</head>
	<body>
		<div class="container">
			<h1>Verify your email address</h1>
			<p>Hello,</p>
			<p>Please verify your email address by clicking the button below:</p>
			<div class="btn-container">
				<a href="${url}" class="btn">Verify Email Address</a>
			</div>
			<p>Or copy and paste this URL into your browser:</p>
			<p><a href="${url}" style="color: #0066cc; text-decoration: none;">${url}</a></p>
			<hr />
			<p style="color: #666666; font-size: 12px;">If you did not request this email, please ignore it.</p>
		</div>
	</body>
	</html>
	`;
}

export function getResetPasswordEmailHtml(
	username: string,
	resetLink: string,
): string {
	return `
	<!DOCTYPE html>
	<html>
	<head>
		<meta charset="utf-8">
		<title>Reset your password</title>
		<style>
			body { font-family: sans-serif; background-color: #ffffff; padding: 20px; }
			.container { border: 1px solid #eaeaea; border-radius: 4px; padding: 20px; max-width: 465px; margin: 40px auto; }
			h1 { color: #000000; font-size: 24px; font-weight: normal; text-align: center; margin: 30px 0; }
			p { font-size: 14px; line-height: 24px; color: #000000; }
			.btn-container { text-align: center; margin: 32px 0; }
			.btn { background-color: #000000; border-radius: 4px; color: #ffffff !important; font-size: 12px; font-weight: 600; text-decoration: none; padding: 12px 20px; display: inline-block; }
			hr { border: 0; border-top: 1px solid #eaeaea; margin: 26px 0; }
		</style>
	</head>
	<body>
		<div class="container">
			<h1>Reset your <strong>Better Auth</strong> password</h1>
			<p>Hello ${username},</p>
			<p>We received a request to reset your password for your Better Auth account. If you didn't make this request, you can safely ignore this email.</p>
			<div class="btn-container">
				<a href="${resetLink}" class="btn">Reset Password</a>
			</div>
			<p>Or copy and paste this URL into your browser:</p>
			<p><a href="${resetLink}" style="color: #0066cc; text-decoration: none;">${resetLink}</a></p>
			<hr />
			<p style="color: #666666; font-size: 12px;">If you didn't request a password reset, please ignore this email or contact support if you have concerns.</p>
		</div>
	</body>
	</html>
	`;
}

export function getInvitationEmailHtml(
	username: string,
	invitedByUsername: string,
	invitedByEmail: string,
	teamName: string,
	inviteLink: string,
): string {
	return `
	<!DOCTYPE html>
	<html>
	<head>
		<meta charset="utf-8">
		<title>Invitation to join an organization</title>
		<style>
			body { font-family: sans-serif; background-color: #ffffff; padding: 20px; }
			.container { border: 1px solid #eaeaea; border-radius: 4px; padding: 20px; max-width: 465px; margin: 40px auto; }
			h1 { color: #000000; font-size: 24px; font-weight: normal; text-align: center; margin: 30px 0; }
			p { font-size: 14px; line-height: 24px; color: #000000; }
			.btn-container { text-align: center; margin: 32px 0; }
			.btn { background-color: #000000; border-radius: 4px; color: #ffffff !important; font-size: 12px; font-weight: 600; text-decoration: none; padding: 12px 20px; display: inline-block; }
			hr { border: 0; border-top: 1px solid #eaeaea; margin: 26px 0; }
		</style>
	</head>
	<body>
		<div class="container">
			<h1>Join <strong>${invitedByUsername}</strong> on <strong>Better Auth.</strong></h1>
			<p>Hello there,</p>
			<p><strong>${invitedByUsername}</strong> (<a href="mailto:${invitedByEmail}" style="color: #0066cc; text-decoration: none;">${invitedByEmail}</a>) has invited you to the <strong>${teamName}</strong> team on <strong>Better Auth</strong>.</p>
			<div class="btn-container">
				<a href="${inviteLink}" class="btn">Join the team</a>
			</div>
			<p>or copy and paste this URL into your browser:</p>
			<p><a href="${inviteLink}" style="color: #0066cc; text-decoration: none;">${inviteLink}</a></p>
			<hr />
			<p style="color: #666666; font-size: 12px;">This invitation was intended for <span style="color: #000000;">${username}</span>. If you were not expecting this invitation, you can ignore this email.</p>
		</div>
	</body>
	</html>
	`;
}
