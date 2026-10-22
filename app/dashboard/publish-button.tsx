"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { publishAction } from "@/app/dashboard/actions";

const PUBLISH_ERROR_KEY: Partial<Record<string, string>> = { EMAIL_NOT_VERIFIED: "email_not_verified", NEEDS_REVIEW: "needs_review", SUSPENDED: "suspended" };

export function PublishButton({ businessId }: { businessId: string }) {
  const t = useTranslations("dashboard");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="grid gap-2">
      <Button
        data-testid="publish"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await publishAction(businessId);
            setError(r.ok ? null : t(`publishErrors.${PUBLISH_ERROR_KEY[r.code] ?? "generic"}`));
          })
        }
      >
        {pending ? t("publishing") : t("publish")}
      </Button>
      {error ? <p role="alert" className="text-sm font-medium text-destructive">{error}</p> : null}
    </div>
  );
}
