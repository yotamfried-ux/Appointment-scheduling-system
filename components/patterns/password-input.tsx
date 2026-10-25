"use client";

import { Eye, EyeOff } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Universal Bi-directional Password Input:
 * - Detects character script dynamically: Hebrew/Arabic typed text renders RTL (align right); Latin/digits render LTR (align left).
 * - Fixed physical padding (pr-11 pl-3.5) and physical icon placement (right-0) ensure text NEVER collides with the eye toggle button in either direction.
 * - When toggling visibility between password bullets and plain text, alignment, cursor position, and icon anchor remain 100% rock-solid.
 */
export function PasswordInput({ className, onChange, style, ...props }: React.ComponentProps<typeof Input>) {
  const t = useTranslations("auth");
  const [visible, setVisible] = useState(false);
  const [isRTL, setIsRTL] = useState(false);

  const checkDirection = useCallback((val: unknown) => {
    if (typeof val === "string" && val.length > 0) {
      // Find the first strong directional character
      const match = val.match(/[\u0590-\u05FF\u0600-\u06FFa-zA-Z]/);
      if (match) {
        setIsRTL(/[\u0590-\u05FF\u0600-\u06FF]/.test(match[0]));
        return;
      }
    }
    // Default to LTR for passwords (empty, numbers, or symbols)
    setIsRTL(false);
  }, []);

  useEffect(() => {
    if (props.value !== undefined) {
      checkDirection(props.value);
    }
  }, [props.value, checkDirection]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    checkDirection(e.target.value);
    onChange?.(e);
  };

  return (
    <div className="relative">
      <Input
        {...props}
        type={visible ? "text" : "password"}
        dir={isRTL ? "rtl" : "ltr"}
        onChange={handleChange}
        style={{
          direction: isRTL ? "rtl" : "ltr",
          textAlign: isRTL ? "right" : "left",
          unicodeBidi: "plaintext",
          ...style,
        }}
        className={cn("pr-11 pl-3.5", isRTL ? "text-right" : "text-left", className)}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? t("hidePassword") : t("showPassword")}
        aria-pressed={visible}
        className="tap absolute inset-y-0 right-0 inline-flex items-center justify-center px-3 text-muted-foreground transition-colors hover:text-foreground"
      >
        {visible ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
      </button>
    </div>
  );
}
