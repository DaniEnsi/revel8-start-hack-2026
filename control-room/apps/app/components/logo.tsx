import Image from "next/image";
import { brandAssets } from "@/lib/brand-assets";
import { cn } from "@/lib/utils";

interface LogoProps {
	className?: string;
}

export const Logo = ({ className }: LogoProps) => {
	const imageClassName = cn("w-auto object-contain", className ?? "h-5");

	return (
		<div className="flex items-center">
			<Image
				src={brandAssets.company.headerForLightBg}
				alt="x70"
				width={256}
				height={114}
				className={cn(imageClassName, "dark:hidden")}
				priority
			/>
			<Image
				src={brandAssets.company.headerForDarkBg}
				alt="x70"
				width={256}
				height={114}
				className={cn(imageClassName, "hidden dark:block")}
				priority
			/>
		</div>
	);
};
