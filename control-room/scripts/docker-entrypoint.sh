#!/bin/sh
set -eu

key_file=/convex-data/revel8-admin-key
valid_key() {
	[ -f "$key_file" ] \
		&& [ "$(grep -Ec '^[^[:space:]]+\|[^[:space:]]+$' "$key_file")" -eq 1 ] \
		&& [ "$(wc -l < "$key_file")" -eq 1 ]
}

attempt=0
while ! valid_key; do
	attempt=$((attempt + 1))
	if [ "$attempt" -gt 120 ]; then
		echo "A valid Convex admin key was not generated within 240 seconds." >&2
		exit 1
	fi
	sleep 2
done

export CONVEX_SELF_HOSTED_URL=http://convex:3210
CONVEX_SELF_HOSTED_ADMIN_KEY="$(tail -n1 "$key_file")"
export CONVEX_SELF_HOSTED_ADMIN_KEY

convex_cli="pnpm --filter @x70-monorepo/database exec convex"
$convex_cli env set BETTER_AUTH_SECRET "$BETTER_AUTH_SECRET"
$convex_cli env set REVEL8_INGEST_SECRET "$REVEL8_INGEST_SECRET"
$convex_cli env set SITE_URL "$SITE_URL"
$convex_cli env set ADMIN_EMAIL "$ADMIN_EMAIL"
$convex_cli env set ADMIN_PASSWORD "$ADMIN_PASSWORD"
$convex_cli env set ADMIN_NAME "${ADMIN_NAME:-revel8 Admin}"
if [ -n "${RESEND_API_KEY:-}" ]; then
	$convex_cli env set RESEND_API_KEY "$RESEND_API_KEY"
fi

$convex_cli dev --once
$convex_cli run init:seedUser

unset CONVEX_SELF_HOSTED_ADMIN_KEY CONVEX_SELF_HOSTED_URL
unset BETTER_AUTH_SECRET ADMIN_EMAIL ADMIN_PASSWORD ADMIN_NAME RESEND_API_KEY

exec pnpm --filter @x70-monorepo/app exec next start -H 0.0.0.0 -p 3000
