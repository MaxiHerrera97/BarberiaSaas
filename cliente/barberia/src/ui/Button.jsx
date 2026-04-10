export default function Button({ children, className = "", ...props }) {
  return (
    <button
      className={[
        "inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-semibold",
        "bg-[var(--brand)] text-zinc-950 hover:bg-[var(--brand-soft)] active:bg-[var(--brand-deep)]",
        "shadow-[0_10px_22px_rgba(217,161,61,0.24)] transition-all duration-200 hover:-translate-y-0.5",
        "focus:outline-none focus:ring-2 focus:ring-[rgba(217,161,61,0.55)]",
        className,
      ].join(" ")}
      {...props}
    >
      {children}
    </button>
  );
}
