import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck, DatabaseZap, ExternalLink, FileText, CheckCircle2 } from "lucide-react";
import { BRAND } from "@/config/brand";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "סביבת תצוגה מקדימה מבודדת | Tori",
  description: "סביבת Vercel Preview מבודדת לחלוטין ממסד הנתונים של הייצור.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function PreviewModePage() {
  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground" dir="rtl">
      {/* Header */}
      <header className="border-b bg-card/50 backdrop-blur-sm">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6">
          <Logo showSubtitle={true} />
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-600 dark:text-amber-400">
              <span className="size-2 rounded-full bg-amber-500 animate-pulse" />
              Preview Environment
            </span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 py-12 sm:py-16">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <div className="rounded-2xl border bg-card p-6 shadow-sm sm:p-10">
            {/* Hero Badge & Title */}
            <div className="flex flex-col items-center text-center">
              <div className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <ShieldCheck className="size-7" />
              </div>
              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
                סביבת תצוגה מקדימה מבודדת
              </h1>
              <p className="mt-3 max-w-xl text-muted-foreground leading-relaxed">
                גרסה זו נפרסה בסביבת Vercel Preview לבדיקת ממשק, קוד ותצוגה בלבד.
                כדי להגן על נתוני האמת של המערכת, סביבה זו <strong>מנותקת לחלוטין</strong> ממסד הנתונים של הייצור.
              </p>
            </div>

            {/* Feature Cards Grid */}
            <div className="mt-8 grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border bg-muted/40 p-5">
                <div className="flex items-center gap-3 font-semibold text-foreground">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                    <DatabaseZap className="size-4" />
                  </span>
                  בידוד מלא מנתוני ייצור
                </div>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  כל פעולות כתיבת הנתונים, רישום המשתמשים, קביעת תורים או סליקה חסומות בסביבה זו. אין גישה או יכולת שינוי של נתונים אמיתיים.
                </p>
              </div>

              <div className="rounded-xl border bg-muted/40 p-5">
                <div className="flex items-center gap-3 font-semibold text-foreground">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <CheckCircle2 className="size-4" />
                  </span>
                  בדיקות ממשק וקוד
                </div>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  הסביבה מיועדת לבחינת עיצוב, נגישות, תצוגה ועמודי תוכן. עמודי המידע והמדיניות הסטטיים זמינים לעיון מלא.
                </p>
              </div>
            </div>

            {/* Actions */}
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-t pt-6">
              <div className="flex flex-wrap items-center gap-3">
                <Button asChild variant="outline" size="sm">
                  <Link href="/privacy" className="gap-1.5">
                    <FileText className="size-3.5" />
                    מדיניות פרטיות
                  </Link>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <Link href="/terms" className="gap-1.5">
                    <FileText className="size-3.5" />
                    תנאי שימוש
                  </Link>
                </Button>
                <Button asChild variant="outline" size="sm">
                  <Link href="/accessibility" className="gap-1.5">
                    <FileText className="size-3.5" />
                    הצהרת נגישות
                  </Link>
                </Button>
              </div>

              <Button asChild variant="default" size="sm">
                <a
                  href="https://turim.d2ryf.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="gap-1.5"
                >
                  מעבר לאתר הייצור
                  <ExternalLink className="size-3.5" />
                </a>
              </Button>
            </div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t py-6 text-center text-xs text-muted-foreground">
        <p>© {new Date().getFullYear()} {BRAND.name}. כל הזכויות שמורות.</p>
      </footer>
    </div>
  );
}
