"use client";

// The last line of defence: the root layout itself failed. Plain markup, no providers, no translations (they may be what failed).
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="he" dir="rtl">
      <body style={{ fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100svh", margin: 0, padding: 16, textAlign: "center" }}>
        <main>
          <h1>משהו השתבש</h1>
          <p>נסו שוב בעוד רגע.</p>
          {error.digest ? <p style={{ fontSize: 12, color: "#555" }}>קוד תקלה: <bdi dir="ltr">{error.digest}</bdi></p> : null}
          <button onClick={reset} style={{ minHeight: 44, padding: "0 20px", fontSize: 16 }}>ניסיון חוזר</button>
        </main>
      </body>
    </html>
  );
}
