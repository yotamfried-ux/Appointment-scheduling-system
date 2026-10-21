"use client";

import { useSyncExternalStore, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { CONSENT_COOKIE, CONSENT_DAYS, OPTIONAL_CATEGORIES, needsDecision, readConsentCookie, serializeConsent } from "@/lib/consent";

const subscribe = (cb: () => void) => {
  window.addEventListener("tori-consent", cb);
  return () => window.removeEventListener("tori-consent", cb);
};
const snapshot = () => document.cookie;

function save(choices: Record<string, boolean>) {
  document.cookie = `${CONSENT_COOKIE}=${serializeConsent(choices)}; Max-Age=${CONSENT_DAYS * 86400}; Path=/; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
  window.dispatchEvent(new Event("tori-consent"));
}

/** Shows only when an optional category exists and has no answer yet; with none registered (today) it renders nothing. */
export function ConsentBanner() {
  const t = useTranslations("legal.consent");
  const cookies = useSyncExternalStore(subscribe, snapshot, () => "");
  if (OPTIONAL_CATEGORIES.length === 0 || !needsDecision(readConsentCookie(cookies))) return null;
  const all = (v: boolean) => save(Object.fromEntries(OPTIONAL_CATEGORIES.map((c) => [c.id, v])));
  return (
    <div role="region" aria-label={t("title")} className="fixed inset-x-3 bottom-3 z-40 mx-auto grid max-w-xl gap-3 rounded-xl border bg-card p-4 shadow-lg" data-testid="consent-banner">
      <div>
        <p className="font-semibold">{t("title")}</p>
        <p className="text-sm text-muted-foreground">{t("body")} <Link href="/cookies" className="underline underline-offset-4">{t("more")}</Link></p>
      </div>
      <div className="flex flex-wrap gap-2">
        {/* equal weight on purpose: declining is as easy as accepting */}
        <Button variant="outline" onClick={() => all(false)} data-testid="consent-decline">{t("decline")}</Button>
        <Button variant="outline" onClick={() => all(true)} data-testid="consent-accept">{t("accept")}</Button>
      </div>
    </div>
  );
}

/** The preferences panel on the cookies page. */
export function ConsentPreferences() {
  const t = useTranslations("legal.consent");
  const cookies = useSyncExternalStore(subscribe, snapshot, () => "");
  const stored = readConsentCookie(cookies);
  const [saved, setSaved] = useState(false);
  if (OPTIONAL_CATEGORIES.length === 0) return <p className="rounded-lg border bg-card p-4 text-sm" data-testid="consent-none">{t("none")}</p>;
  return (
    <div className="grid gap-3 rounded-lg border bg-card p-4" data-testid="consent-prefs">
      {OPTIONAL_CATEGORIES.map((c) => (
        <label key={c.id} className="flex items-start gap-3 text-sm">
          <input type="checkbox" className="mt-1 size-5" defaultChecked={stored?.choices[c.id] === true} onChange={(e) => { save({ ...(stored?.choices ?? {}), [c.id]: e.target.checked }); setSaved(true); }} />
          <span><span className="block font-semibold">{c.label}</span><span className="text-muted-foreground">{c.description}</span></span>
        </label>
      ))}
      {saved ? <p role="status" className="text-sm font-medium">{t("saved")}</p> : null}
    </div>
  );
}
