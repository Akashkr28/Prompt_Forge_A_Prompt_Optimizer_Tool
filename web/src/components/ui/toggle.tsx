"use client";

/** `.toggle` — a small pill switch with a sliding thumb (track/thumb pair driven by `:checked`). */
export function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <label className={`relative inline-block h-[22px] w-10 flex-shrink-0 ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.checked)}
        aria-label={label}
        className="peer sr-only"
      />
      <span className="absolute inset-0 rounded-[11px] bg-warm transition-colors duration-200 peer-checked:bg-accent-2" />
      <span className="absolute left-[3px] top-[3px] h-4 w-4 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.2)] transition-transform duration-200 peer-checked:translate-x-[18px]" />
    </label>
  );
}
