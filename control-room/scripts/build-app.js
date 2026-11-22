const { spawnSync } = require("child_process");
const path = require("path");

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (convexUrl?.includes(".convex.cloud")) {
	process.env.NEXT_PUBLIC_CONVEX_SITE_URL = convexUrl.replace(
		".convex.cloud",
		".convex.site",
	);
	console.log(
		`Derived NEXT_PUBLIC_CONVEX_SITE_URL: ${process.env.NEXT_PUBLIC_CONVEX_SITE_URL}`,
	);
}

console.log("Building Next.js application...");
const buildResult = spawnSync(
	"pnpm",
	["-w", "exec", "turbo", "run", "build", "--filter=@x70-monorepo/app"],
	{
		cwd: path.join(__dirname, ".."),
		stdio: "inherit",
		shell: true,
	},
);

process.exit(buildResult.status ?? 0);
