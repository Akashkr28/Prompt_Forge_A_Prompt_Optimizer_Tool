import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "accent" | "ghost";
type Size = "md" | "sm";

const base =
  "inline-flex items-center gap-1.5 rounded-md font-sans text-[13px] font-medium tracking-[0.01em] " +
  "transition-all duration-100 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0";

const variants: Record<Variant, string> = {
  primary: "border-none bg-ink text-paper hover:bg-[#1e2025] hover:-translate-y-px",
  accent: "border-none bg-accent text-white hover:bg-[#b0421e] hover:-translate-y-px",
  ghost: "border border-border bg-transparent text-ink hover:bg-cream hover:border-warm",
};

const sizes: Record<Size, string> = {
  md: "px-[18px] py-[9px]",
  sm: "px-3 py-[5px] text-[11px]",
};

/** `.btn` / `.btn-primary` / `.btn-accent` / `.btn-ghost` / `.btn-sm` */
export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return <button className={`${base} ${variants[variant]} ${sizes[size]} ${className}`} {...props} />;
}
