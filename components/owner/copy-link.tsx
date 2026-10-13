"use client";

import { Check, Copy } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";

/** Copies the booking link. If the browser refuses (no permission, insecure context) the link stays selectable text next to it, so nothing is lost. */
export function CopyLink({ url }: { url: string }) {
  const t = useTranslations("dashboard");
  const [done, setDone] = useState(false);
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      data-testid="copy-link"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(url);
          setDone(true);
          setTimeout(() => setDone(false), 2000);
        } catch {
          setDone(false);
        }
      }}
    >
      {done ? <Check aria-hidden /> : <Copy aria-hidden />}
      <span role="status">{done ? t("copied") : t("copy")}</span>
    </Button>
  );
}
