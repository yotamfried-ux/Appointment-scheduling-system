import { readFile } from "node:fs/promises";
import path from "node:path";
import { ImageResponse } from "next/og";

let cachedFonts: { regular: Buffer; bold: Buffer } | null = null;

async function loadFonts() {
  if (cachedFonts) return cachedFonts;
  const dir = path.join(process.cwd(), "lib", "og", "fonts");
  const [regular, bold] = await Promise.all([
    readFile(path.join(dir, "font-400.woff")),
    readFile(path.join(dir, "font-700.woff")),
  ]);
  cachedFonts = { regular, bold };
  return cachedFonts;
}

export type SwissEditorialOgParams = {
  brandInitial?: string;
  brandName: string;
  brandSub?: string;
  heading: string;
  sub?: string;
  domain?: string;
  footerRight?: string;
};

export async function createSwissEditorialOgImage(params: SwissEditorialOgParams) {
  const { regular, bold } = await loadFonts();
  const initial = params.brandInitial || params.brandName.charAt(0) || "D";
  const domain = params.domain || "turim.d2ryf.com";
  const footerRight = params.footerRight || "ניהול יומן ותורים";

  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          width: "100%",
          height: "100%",
          backgroundColor: "#0d0f12",
          color: "#f8fafc",
          padding: "70px 80px",
          fontFamily: "IBMPlexSansHebrew",
          direction: "rtl",
        }}
      >
        {/* Top Brand Bar */}
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <div
            style={{
              width: "48px",
              height: "48px",
              borderRadius: "10px",
              background: "linear-gradient(135deg, #0ea5e9, #0284c7)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#ffffff",
              fontWeight: 700,
              fontSize: "26px",
            }}
          >
            {initial}
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: "26px", fontWeight: 700, color: "#f8fafc" }}>
              {params.brandName}
            </div>
            {params.brandSub ? (
              <div style={{ fontSize: "15px", color: "#64748b" }}>
                {params.brandSub}
              </div>
            ) : null}
          </div>
        </div>

        {/* Center Content */}
        <div style={{ display: "flex", flexDirection: "column", maxWidth: "90%" }}>
          <div style={{ fontSize: "46px", fontWeight: 700, color: "#ffffff", lineHeight: 1.25 }}>
            {params.heading}
          </div>
          {params.sub ? (
            <div style={{ fontSize: "22px", color: "#94a3b8", marginTop: "16px", lineHeight: 1.4 }}>
              {params.sub}
            </div>
          ) : null}
        </div>

        {/* Footer Bar */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            borderTop: "1px solid rgba(255,255,255,0.1)",
            paddingTop: "22px",
            fontSize: "18px",
            color: "#64748b",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div style={{ width: "10px", height: "10px", borderRadius: "50%", background: "#0ea5e9" }} />
            <span style={{ color: "#94a3b8" }}>{domain}</span>
          </div>
          <div>{footerRight}</div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      fonts: [
        { name: "IBMPlexSansHebrew", data: regular, weight: 400 },
        { name: "IBMPlexSansHebrew", data: bold, weight: 700 },
      ],
    }
  );
}
