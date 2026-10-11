import type { Metadata, Viewport } from "next";
import { Heebo } from "next/font/google";
import { headers } from "next/headers";
import { connection } from "next/server";
import { ThemeProvider } from "next-themes";
import "./globals.css";

const defaultUrl = process.env.NEXT_PUBLIC_SITE_URL
  ? process.env.NEXT_PUBLIC_SITE_URL
  : process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(defaultUrl),
  title: { default: "קביעת תורים", template: "%s · קביעת תורים" },
  description: "מערכת קביעת תורים לעסקים קטנים",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

const heebo = Heebo({
  variable: "--font-sans",
  display: "swap",
  subsets: ["hebrew", "latin"],
});

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // CSP nonces are applied during SSR from the per-request header (proxy.ts), so every
  // page must render per request. Static prerendering would ship scripts WITHOUT a nonce
  // and the browser would block them (found by tests/e2e/foundation.spec.ts).
  await connection();
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="he" dir="rtl" suppressHydrationWarning>
      <body className={`${heebo.variable} font-sans antialiased`}>
        <ThemeProvider nonce={nonce} attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
