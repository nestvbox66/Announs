import { useState } from "react";

interface LanguageFlagProps {
  src?: string | null;
  name?: string | null;
  size?: "sm" | "md" | "lg";
}

const sizes: Record<NonNullable<LanguageFlagProps["size"]>, string> = {
  sm: "h-6 w-6 text-[10px]",
  md: "h-8 w-8 text-xs",
  lg: "h-10 w-10 text-sm",
};

function isUrl(value: string | null | undefined): value is string {
  return typeof value === "string" && /^(https?:\/\/|blob:)/.test(value);
}

export default function LanguageFlag({ src, name, size = "sm" }: LanguageFlagProps) {
  const [failed, setFailed] = useState(false);
  const dimension = sizes[size];
  const initials = (name ?? "?")
    .split(" ")
    .map((part) => part.charAt(0))
    .join("")
    .slice(0, 2)
    .toUpperCase();

  if (isUrl(src) && !failed) {
    return (
      <img
        src={src}
        alt={name ?? "bandera"}
        onError={() => setFailed(true)}
        className={`${dimension} shrink-0 rounded-full bg-slate-800 object-cover ring-1 ring-white/10`}
      />
    );
  }

  return (
    <span
      className={`${dimension} flex shrink-0 items-center justify-center rounded-full bg-sky-500/15 font-semibold text-sky-400 ring-1 ring-sky-500/20`}
    >
      {initials}
    </span>
  );
}
