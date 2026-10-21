"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { FormField } from "@/components/patterns/form-field";
import { NativeSelect } from "@/components/ui/native-select";

export function ServicePicker({ services, value }: { services: { id: string; name: string }[]; value: string }) {
  const t = useTranslations("settings.preview");
  const router = useRouter();
  return (
    <FormField label={t("service")} className="max-w-xs">
      {(a) => (
        <NativeSelect {...a} value={value} onChange={(e) => router.push(`/settings/hours?service=${e.target.value}`)} data-testid="preview-service">
          {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </NativeSelect>
      )}
    </FormField>
  );
}
