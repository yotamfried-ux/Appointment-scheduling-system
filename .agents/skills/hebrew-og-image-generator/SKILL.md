---
name: hebrew-og-image-generator
description: >-
  Generates crisp, responsive OpenGraph and social share preview images (1200x630) for Next.js
  with full RTL Hebrew typography support using Satori, ImageResponse, and local IBM Plex Sans Hebrew fonts.
  Use when creating or updating social share cards, dynamic booking OG images, or WhatsApp previews.
---

# Hebrew OpenGraph Image Generator

Guide for creating high-performance, RTL-compatible OG preview images in Next.js.

## Key Principles

1. **Font Ingestion**:
   * Satori requires raw ArrayBuffer font files.
   * Store WOFF files locally (e.g. `lib/og/fonts/font-400.woff`, `font-700.woff`) extracted from `@fontsource/ibm-plex-sans-hebrew`.
   * Cache fonts in memory to avoid repeated filesystem reads on serverless invocations.

2. **Styling & Layout (Swiss Editorial Minimalist)**:
   * Resolution: 1200x630 pixels.
   * Direction: Explicit `direction: "rtl"` on root container.
   * Background: Off-white canvas (`#FAFAFA`) with subtle borders.
   * Brand badge: Dark pill (`#0F172A`) with white text and clean SVG calendar icon.
   * Typography: Bold headline (52-60px), subtle subtitle (24-28px).
   * Bottom bar: Clean metadata pill (e.g. `turim.d2ryf.com` or business details).

3. **Dynamic Route Integration**:
   * File locations: `app/opengraph-image.tsx` (Root) and `app/book/[slug]/opengraph-image.tsx` (Dynamic per business).
   * Fallback gracefully if business logo or custom details fail to load.
