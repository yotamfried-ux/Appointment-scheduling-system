import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { connection } from "next/server";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import { clientNamespacesFor, pickNamespaces } from "@/i18n/client-messages";
import { ThemeProvider } from "next-themes";
import { ConsentBanner } from "@/components/legal/consent-banner";
import { Toaster } from "@/components/ui/toast";
import "./globals.css";

const defaultUrl = process.env.NEXT_PUBLIC_SITE_URL
  ? process.env.NEXT_PUBLIC_SITE_URL
  : process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(defaultUrl),
  title: { default: "מערכת ניהול יומן ותורים", template: "%s · מערכת ניהול יומן ותורים" },
  description: "מערכת קביעת תורים לעסקים קטנים",
  applicationName: "תורים",
  openGraph: { siteName: "תורים", locale: "he_IL", type: "website" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // CSP nonces are applied during SSR from the per-request header (proxy.ts), so every
  // page must render per request. Static prerendering would ship scripts WITHOUT a nonce
  // and the browser would block them (found by tests/e2e/foundation.spec.ts).
  await connection();
  const h = await headers();
  const nonce = h.get("x-nonce") ?? undefined;
  const t = await getTranslations("common");
  const messages = pickNamespaces(await getMessages(), clientNamespacesFor(h.get("x-pathname")));
  return (
    <html lang="he" dir="rtl" suppressHydrationWarning>
      <body className="font-sans antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
        >
          {t("skipToContent")}
        </a>
        <NextIntlClientProvider messages={messages}>
          <ThemeProvider nonce={nonce} attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
            {children}
            <ConsentBanner />
            <Toaster closeLabel={t("close")} />
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
