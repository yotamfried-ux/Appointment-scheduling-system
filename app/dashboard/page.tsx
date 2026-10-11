import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// Placeholder: real dashboard arrives in stage 5. Auth is enforced in proxy.ts
// AND re-checked here (defense in depth, docs/05 §4.2).
export default async function DashboardPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims) redirect("/auth/login");

  return (
    <main className="mx-auto max-w-5xl p-5">
      <h1 className="text-2xl font-bold">לוח בקרה</h1>
      <p className="text-muted-foreground" data-testid="whoami">
        {String(data.claims.email ?? "")}
      </p>
    </main>
  );
}
