"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { publishAction } from "@/app/dashboard/actions";

const PUBLISH_ERROR_KEY: Partial<Record<string, string>> = { EMAIL_NOT_VERIFIED: "email_not_verified", NEEDS_REVIEW: "needs_review", SUSPENDED: "suspended" };

/** A business that is still a draft is published as soon as its owner opens the dashboard; the button stays as the way to retry if that was refused (e.g. the e-mail is not verified yet). */
export function PublishButton({ businessId }: { businessId: string }) {
  const t = useTranslations("dashboard");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const tried = useRef(false);
  const publish = () =>
    start(async () => {
      const r = await publishAction(businessId);
      setError(r.ok ? null : t(`publishErrors.${PUBLISH_ERROR_KEY[r.code] ?? "generic"}`));
      if (r.ok) router.refresh();
    });
  useEffect(() => {
    if (tried.current) return;
    tried.current = true;
    publish();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- once per visit
  return (
    <div className="grid gap-2">
      <Button
        data-testid="publish"
        disabled={pending}
        onClick={publish}
      >
        {pending ? t("publishing") : t("publish")}
      </Button>
      {error ? <p role="alert" className="text-sm font-medium text-destructive">{error}</p> : null}
    </div>
  );
}
