// Avatar (PLAN-002 G-002): картинка или инициал.
import { cn } from "@/lib/utils";

export function Avatar({
  src,
  name,
  size = "md",
  className,
}: {
  src?: string | null;
  name: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const px = { sm: "h-8 w-8 text-xs", md: "h-12 w-12 text-lg", lg: "h-16 w-16 text-xl" }[size];
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={name} className={cn("rounded-full object-cover", px, className)} />;
  }
  return (
    <div
      aria-hidden
      className={cn(
        "rounded-full bg-accent-soft text-accent-strong flex items-center justify-center font-bold flex-shrink-0",
        px,
        className
      )}
    >
      {name.slice(0, 1).toUpperCase()}
    </div>
  );
}
