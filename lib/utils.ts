import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { isPreviewWithoutDb } from "@/lib/preview-isolation";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// True when valid, non-isolated Supabase env vars are configured.
export const hasEnvVars = Boolean(
  !isPreviewWithoutDb() &&
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
);
