"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, Sparkles } from "lucide-react";
import { checkSignupVerificationAction } from "@/app/auth/actions";

export function SignUpWatcher({
  waitingText = "ממתין לאימות כתובת האימייל…",
  crossDeviceTip = "נרשמתם מהמחשב? אפשר לאמת מהטלפון — עמוד זה יזהה את האימות אוטומטית וימשיך להגדרת העסק.",
  verifiedText = "האימייל אומת בהצלחה! מעביר אותך להגדרת העסק…",
}: {
  waitingText?: string;
  crossDeviceTip?: string;
  verifiedText?: string;
}) {
  const [status, setStatus] = useState<"polling" | "verified">("polling");

  useEffect(() => {
    let active = true;
    let timer: NodeJS.Timeout;
    const startTime = Date.now();
    const MAX_DURATION_MS = 10 * 60 * 1000; // 10 minutes

    async function poll() {
      if (!active || status === "verified") return;
      if (Date.now() - startTime > MAX_DURATION_MS) return;

      try {
        const result = await checkSignupVerificationAction();
        if (result.verified && active) {
          setStatus("verified");
          // Give user a brief moment to see the success state, then redirect
          setTimeout(() => {
            window.location.href = result.redirect || "/dashboard";
          }, 800);
          return;
        }
      } catch {
        // Silently continue polling on transient network glitches
      }

      if (active) {
        timer = setTimeout(poll, 3000);
      }
    }

    timer = setTimeout(poll, 2500);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [status]);

  if (status === "verified") {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4 text-emerald-800 dark:text-emerald-200 transition-all">
        <CheckCircle2 className="size-5 shrink-0 text-emerald-600 dark:text-emerald-400 animate-pulse" aria-hidden />
        <p className="text-sm font-medium">{verifiedText}</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
        <Loader2 className="size-4 animate-spin text-primary shrink-0" aria-hidden />
        <span>{waitingText}</span>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed flex items-start gap-1.5">
        <Sparkles className="size-3.5 text-primary shrink-0 mt-0.5" aria-hidden />
        <span>{crossDeviceTip}</span>
      </p>
    </div>
  );
}
