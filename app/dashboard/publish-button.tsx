"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { publishAction } from "@/app/dashboard/actions";

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
            setError(r.ok ? null : t(`publishErrors.${r.code === "EMAIL_NOT_VERIFIED" ? "email_not_verified" : "generic"}`));
          })
        }
      >
        {pending ? t("publishing") : t("publish")}
      </Button>
      {error ? <p role="alert" className="text-sm font-medium text-destructive">{error}</p> : null}
    </div>
  );
}
