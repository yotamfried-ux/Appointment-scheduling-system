"use client";

import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";

export function PasswordInput(props: React.ComponentProps<typeof Input>) {
  const t = useTranslations("auth");
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={visible ? "text" : "password"} className="pe-11" />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? t("hidePassword") : t("showPassword")}
        aria-pressed={visible}
        className="tap absolute inset-y-0 end-0 inline-flex items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
      >
        {visible ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
      </button>
    </div>
  );
}
