"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { confirmAttendanceAction } from "@/app/booking/[token]/actions";
import { Button } from "@/components/ui/button";

/** NSH-01: one tap to say "I am coming". Changes nothing about the booking itself. */
export function AttendButton({ attendToken }: { attendToken: string }) {
  const t = useTranslations("manage");
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const run = () =>
    start(async () => {
      const r = await confirmAttendanceAction(attendToken);
      if (r === "confirmed" || r === "already" || r === "not_active") return router.refresh();
      setMessage(t("invalid"));
    });
  return (
    <div className="grid gap-1">
      <Button size="lg" className="w-full" disabled={pending} onClick={run} data-testid="attend-confirm">{pending ? t("attending") : t("attend")}</Button>
      {message ? <p role="alert" className="text-sm font-medium text-destructive">{message}</p> : null}
    </div>
  );
}
