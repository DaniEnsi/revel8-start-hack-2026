const { spawnSync } = require("child_process");
const path = require("path");

const dbDir = path.join(__dirname, "../packages/database");
const buildAppPath = path.join(__dirname, "build-app.js");
const isPreview = process.env.VERCEL_ENV === "preview";
const branchUrl = process.env.VERCEL_BRANCH_URL || process.env.VERCEL_URL;
const branchName = process.env.VERCEL_GIT_COMMIT_REF;

function run(args) {
	return (
		spawnSync("npx", args, {
			cwd: dbDir,
			stdio: "inherit",
			shell: false,
		}).status ?? 1
	);
}

// 1. Deploy Convex (creates an isolated preview backend or deploys production)
//    and build the Next.js app via --cmd with the deployment URL injected.
//    The build command is passed as a single arg so convex runs it verbatim.
console.log("Deploying Convex and building app...");
const deployArgs = [
	"convex",
	"deploy",
	"--cmd-url-env-var-name",
	"NEXT_PUBLIC_CONVEX_URL",
	"--cmd",
	`node ${JSON.stringify(buildAppPath)}`,
];

// For previews, let convex run the seed function automatically post-deploy.
// This executes with correct deployment permissions.
if (isPreview) {
	deployArgs.push("--preview-run", "init:seedUser");
}

const deployStatus = run(deployArgs);
if (deployStatus !== 0) {
	process.exit(deployStatus);
}

// 2. For previews, point Better Auth at the dynamic Vercel preview origin so
//    auth redirects and email links resolve correctly.
if (isPreview && branchUrl && branchName) {
	const siteUrl = `https://${branchUrl}`;
	console.log(
		`Setting Convex SITE_URL to ${siteUrl} for preview deployment: ${branchName}...`,
	);
	if (
		run([
			"convex",
			"env",
			"set",
			"SITE_URL",
			siteUrl,
			"--preview-name",
			branchName,
		]) !== 0
	) {
		console.warn(
			"Warning: failed to set SITE_URL on Convex preview deployment.",
		);
	}
}

// 3. Ensure the admin account exists (idempotent) on the production deployment.
//    (Previews are handled by `--preview-run` above).
if (!isPreview) {
	console.log("Seeding admin user...");
	if (run(["convex", "run", "init:seedUser"]) !== 0) {
		console.warn("Warning: admin seed step did not complete cleanly.");
	}
}

process.exit(0);
