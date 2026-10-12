import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { fakeCancelAction, fakePayAction } from "@/app/billing/fake-checkout/actions";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ownerPage } from "@/lib/auth/owner-page";
import { billingProvider } from "@/modules/billing/config";
import { billingView } from "@/modules/billing/service";

export const metadata = { title: "תשלום (דמה)", robots: { index: false, follow: false } };

// The provider's hosted page, simulated. It exists only for the fake provider (never in production).
export default async function FakeCheckout({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  if (billingProvider().name !== "fake") notFound();
  const t = await getTranslations("billing.fake");
  const { ctx, email } = await ownerPage();
  const sp = await searchParams;
  const view = await billingView(ctx);
  const plan = view.plans.find((p) => p.id === sp.plan);
  const portal = sp.portal === "1";
  if (!portal && !plan) notFound();
  return (
    <AppShell email={email}>
      <div className="grid gap-4 rounded-lg border bg-card p-5" data-testid="fake-checkout">
        <Badge variant="outline" className="w-fit">{t("badge")}</Badge>
        {portal ? (
          <>
            <h1 className="text-2xl font-bold">{t("portalTitle")}</h1>
            <form action={fakeCancelAction} className="flex flex-wrap gap-2">
              <Button type="submit" variant="destructive" data-testid="fake-cancel">{t("cancel")}</Button>
              <Button asChild variant="outline"><a href="/settings/billing">{t("return")}</a></Button>
            </form>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-bold">{t("title", { plan: plan!.name })}</h1>
            <p className="text-sm text-muted-foreground">{t("desc")}</p>
            <form action={fakePayAction} className="grid gap-4">
              <input type="hidden" name="plan" value={plan!.id} />
              <label className="grid gap-1 text-sm">
                <span className="text-muted-foreground">{t("delay")}</span>
                <select name="delay" defaultValue="0" className="h-11 w-fit rounded-md border bg-background px-3" data-testid="fake-delay">
                  <option value="0">{t("delayNone")}</option>
                  <option value="3000">{t("delay3")}</option>
                </select>
              </label>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" name="outcome" value="pay" data-testid="fake-pay">{t("pay")}</Button>
                <Button type="submit" name="outcome" value="fail" variant="outline" data-testid="fake-fail">{t("fail")}</Button>
                <Button asChild variant="ghost"><a href="/settings/billing">{t("back")}</a></Button>
              </div>
            </form>
          </>
        )}
      </div>
    </AppShell>
  );
}
