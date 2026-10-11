import Link from "next/link";
import { Suspense } from "react";
import { AuthButton } from "@/components/auth-button";
import { ThemeSwitcher } from "@/components/theme-switcher";

export default function Home() {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b">
        <nav className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-5 text-sm">
          <Link href="/" className="font-semibold">
            קביעת תורים
          </Link>
          <Suspense>
            <AuthButton />
          </Suspense>
        </nav>
      </header>
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-start justify-center gap-4 px-5">
        <h1 className="text-3xl font-bold">המערכת בבנייה</h1>
        <p className="text-muted-foreground">שלב 0 · תשתית, אבטחה ובדיקות.</p>
      </main>
      <footer className="flex items-center justify-center gap-4 border-t py-6 text-xs text-muted-foreground">
        <ThemeSwitcher />
      </footer>
    </div>
  );
}
