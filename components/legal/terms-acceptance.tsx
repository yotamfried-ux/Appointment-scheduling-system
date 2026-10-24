"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { currentAcceptance, hasAcceptedCurrent, rememberAcceptance } from "@/lib/legal/customer-acceptance";

const subscribe = (cb: () => void) => {
  window.addEventListener("storage", cb);
  return () => window.removeEventListener("storage", cb);
};

/** State for the customer's one-time acceptance of the terms and the privacy policy. Starts as "needed" (safe without JS or storage) and drops to "not needed" once the browser is known to hold the current versions. */
export function useTermsAcceptance() {
  const t = useTranslations("legal.termsAccept");
  const remembered = useSyncExternalStore(subscribe, hasAcceptedCurrent, () => false); // the server (and the first paint) assume "not accepted": safe without JS or storage
  const [checked, setChecked] = useState(false);
  const needed = !remembered;
  return {
    needed,
    checked,
    setChecked,
    /** Whether the form may be sent. */
    ok: !needed || checked,
    requiredMessage: t("required"),
    /** The body field: the versions that were shown (needed) or remembered (not needed). */
    payload: currentAcceptance(),
    /** Call after the server accepted the request. */
    remember: () => rememberAcceptance(),
  };
}

export function TermsAcceptanceBox({ checked, onChange, error, testId = "terms-accept" }: { checked: boolean; onChange: (v: boolean) => void; error?: string; testId?: string }) {
  const t = useTranslations("legal.termsAccept");
  return (
    <div className="grid gap-1.5" data-testid={`${testId}-box`}>
      <div className="flex items-start gap-3">
        <Checkbox id={testId} checked={checked} onCheckedChange={(v) => onChange(v === true)} aria-invalid={error ? true : undefined} aria-describedby={error ? `${testId}-error` : undefined} className="mt-0.5 size-5" data-testid={testId} />
        <label htmlFor={testId} className="min-h-6 text-sm leading-6">
          {t.rich("label", {
            terms: (c) => <Link href="/terms" target="_blank" className="font-medium underline underline-offset-2">{c}</Link>,
            privacy: (c) => <Link href="/privacy" target="_blank" className="font-medium underline underline-offset-2">{c}</Link>,
          })}
        </label>
      </div>
      {error ? <p id={`${testId}-error`} role="alert" className="text-sm font-medium text-destructive" data-testid={`${testId}-error`}>{error}</p> : null}
    </div>
  );
}
