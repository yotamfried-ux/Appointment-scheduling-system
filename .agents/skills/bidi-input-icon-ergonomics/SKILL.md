---
name: bidi-input-icon-ergonomics
description: >-
  Comprehensive engineering and UX protocol for bi-directional (RTL/LTR) input fields with inline action icons.
  Covers password reveals, search bars, phone inputs, currency/numbers, date pickers, and async status icons.
  Includes native browser control suppression (::-ms-reveal, ::-webkit-search-cancel-button),
  physical vs logical clearance, and dynamic script detection.
  Use whenever creating, styling, or reviewing input fields with icons in multilingual or RTL systems.
---

# Bi-directional Input & Inline Icon Ergonomics (RTL / LTR)

A production-grade protocol for designing and implementing input fields with inline action buttons in Hebrew/English and bilingual applications. Ensures text never collides with icons, layouts never jitter across keyboard language changes, and duplicate browser controls are permanently neutralized.

---

## 1. The Core 4 Universal Pillars

### Pillar 1: Anchor Action Icons with Physical Coordinates
* **Never use logical positioning** (`start-0` / `end-0`) for action buttons (reveals, clears, steppers, status icons) in fields that can accept mixed or bi-directional text.
* Logical coordinates flip sides when the user toggles between Hebrew (RTL) and English (LTR), causing buttons to jump across the screen and disorient users.
* **Always anchor using physical coordinates** (e.g. `right-0` or `left-0`). The icon remains in a predictable, rock-solid location regardless of typed language.

### Pillar 2: Asymmetric Physical Clearance Padding
* When an action button is physically anchored at `right-0` (occupying ~36–40px):
  * Apply **physical right padding** (`pr-11`, 44px) and standard left padding (`pl-3.5`, 14px).
  * **When typing in Hebrew (RTL)**: Text aligns to the right, but starts 44px away from the right border—safely to the left of the button—and flows leftwards. Zero overlap.
  * **When typing in English (LTR)**: Text aligns to the left, flows rightwards, and stops safely 44px before hitting the button. Zero overlap.
* If an icon is physically anchored at `left-0`:
  * Apply `pl-11 pr-3.5`.
* If icons exist on **both sides** (e.g. search icon on left + clear button on right):
  * Apply symmetric physical padding: `px-11`.

### Pillar 3: Always Suppress Native Browser Vendor Controls
Browsers (especially Microsoft Edge, Chromium, and Safari) automatically inject proprietary pseudo-elements when users interact with specific input types. When building custom UI icons, these browser controls must be suppressed with unlayered CSS and `!important`:

```css
/* Edge / IE password reveal button */
input::-ms-reveal,
input[type="password"]::-ms-reveal {
  display: none !important;
  width: 0 !important;
  height: 0 !important;
  pointer-events: none !important;
  visibility: hidden !important;
}

/* Edge / IE input clear button */
input::-ms-clear,
input[type="password"]::-ms-clear {
  display: none !important;
  width: 0 !important;
  height: 0 !important;
  pointer-events: none !important;
  visibility: hidden !important;
}

/* WebKit / Chromium native search clear & decoration */
input[type="search"]::-webkit-search-cancel-button,
input[type="search"]::-webkit-search-decoration {
  -webkit-appearance: none !important;
  display: none !important;
}

/* Number input native stepper spinners */
input[type="number"]::-webkit-inner-spin-button,
input[type="number"]::-webkit-outer-spin-button {
  -webkit-appearance: none !important;
  margin: 0 !important;
}
input[type="number"] {
  -moz-appearance: textfield;
}
```

### Pillar 4: Dynamic Script Detection (Reactive Directionality)
* In masked fields (`type="password"`), native `dir="auto"` fails because bullet masks hide character scripts from the layout engine.
* Detect the first strong directional character reactively:
  ```typescript
  export function detectDirection(value: string): "rtl" | "ltr" {
    if (!value) return "ltr";
    const match = value.match(/[\u0590-\u05FF\u0600-\u06FFa-zA-Z]/);
    if (match) {
      return /[\u0590-\u05FF\u0600-\u06FF]/.test(match[0]) ? "rtl" : "ltr";
    }
    return "ltr"; // Default to LTR for numbers, Latin, or symbols
  }
  ```
* Apply both `dir` and inline `textAlign` + `unicodeBidi: "plaintext"`.

---

## 2. Field-by-Field Architectures

### A. Password Input Fields
* **Controls**: Custom Show/Hide toggle button (`<Eye>` / `<EyeOff>`).
* **Placement**: Physical `right-0`.
* **Clearance**: `pr-11 pl-3.5`.
* **Component-Level Guarantee**: In addition to `globals.css`, render an embedded `<style>` inside the component to prevent any CSS cascade layer from overriding the `::-ms-reveal` suppression.

### B. Search & Filter Inputs
* **Controls**: Search magnifying glass (prefix) + Clear 'X' button (suffix, shown only when non-empty).
* **Placement**: Magnifying glass at physical `right-3`, Clear button at physical `left-2` (or vice-versa).
* **Clearance**: `pr-10 pl-10` (symmetric padding so long queries don't collide with either icon).
* **Native Suppression**: Disable `::-webkit-search-cancel-button` so the browser doesn't draw a second clear cross.

### C. Phone Number & International Inputs
* **Controls**: Country code prefix (`+972`) or flag dropdown.
* **Placement**: Prefix anchored physically to the right or left.
* **Formatting**: Digits always render LTR (`direction: ltr; text-align: start;`).
* **Placeholders**: While typed digits are LTR, the placeholder in Hebrew must align to the right:
  ```css
  input[type="tel"] {
    direction: ltr;
    text-align: start;
  }
  input[type="tel"]::placeholder {
    direction: rtl;
    text-align: start;
  }
  ```

### D. Currency, Price & Metric Inputs
* **Controls**: Currency symbol prefix (₪ / $ / €) or unit suffix (ש"ח / ק"ג).
* **Placement**: Physical anchor for the currency symbol (`right-3` for Hebrew ₪, or `left-3` for $).
* **Clearance**: `pr-8 pl-3.5` for ₪.
* **Direction**: Number values always format with `font-variant-numeric: tabular-nums` to ensure numbers align neatly in lists and tables.

### E. Date & Time Inputs with Calendar Pickers
* **Controls**: Calendar icon button or custom date picker trigger.
* **Text Isolation**: Always wrap dates (`25/10/2026`) and time intervals (`09:00 - 13:00`) in `<bdi>` or apply `.ltr-isolate { unicode-bidi: isolate; }`. Without isolation, surrounding Hebrew text will transpose the day and month order in browser rendering engines.

### F. Inputs with Async Validation / Status Indicators
* **Controls**: Live spinner (validating), green checkmark (valid), red alert (error).
* **Stability Invariant**: Wrap the icon in a fixed-dimension container (`size-5 inline-flex items-center justify-center`). This prevents input width or padding jitter when transitioning between idle, validating, and error states.

---

## 3. Pre-flight Ergonomics Checklist

- [ ] Action buttons use physical anchor coordinates (`right-0` or `left-0`), never logical (`end-0`).
- [ ] Physical padding clearance (`pr-11` or `pl-11`) prevents text overlap in both RTL and LTR typing.
- [ ] Native Edge/Chromium `::-ms-reveal` and `::-ms-clear` are disabled and verified in real Edge.
- [ ] Native search cancel and number spin buttons are disabled when custom controls are used.
- [ ] Password visibility toggle maintains cursor focus and never shifts button position.
- [ ] Phone inputs maintain LTR digits with localized RTL placeholders.
- [ ] Dates and numbers embedded in Hebrew text use `<bdi>` or `unicode-bidi: isolate`.
- [ ] Touch targets for all interactive inline buttons are $\ge 44\times 44$ px (`.tap`).
