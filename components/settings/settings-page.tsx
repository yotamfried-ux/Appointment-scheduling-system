import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/patterns/page-header";
import { OwnerNav } from "@/components/owner/owner-nav";
import { SettingsNav } from "@/components/settings/settings-nav";

export function SettingsPage({ email, title, description, children }: { email: string; title: string; description?: string; children: React.ReactNode }) {
  return (
    <AppShell email={email} width="max-w-3xl" nav={<OwnerNav current="settings" />}>
      <PageHeader title={title} description={description} />
      <SettingsNav />
      {children}
    </AppShell>
  );
}
