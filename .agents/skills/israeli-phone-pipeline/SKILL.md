---
name: israeli-phone-pipeline
description: >-
  Standardized pipeline for normalizing, validating, formatting, and rendering Israeli phone numbers
  across frontend inputs, UI displays, and backend models.
  Use whenever handling phone numbers, customer contact inputs, or formatting phone displays.
---

# Israeli Phone Pipeline

Standard procedure for handling Israeli mobile and landline numbers.

## Architecture

### 1. Normalization & Storage (E.164)
* Always use `normalizePhone(input)` from `@/lib/phone` backed by `libphonenumber-js/min`.
* Any valid Israeli mobile (`0501234567`, `050-123-4567`, `+972501234567`) must be stored strictly as:
  `+972501234567`.
* Landlines (`035551234`, `03-555-1234`) normalize to `+97235551234`.
* Invalid or short inputs return `null` and trigger localized validation messages.

### 2. Uniform UI Presentation (`formatPhone`)
* Whenever displaying a phone number to users, wrap it with `formatPhone(number)`.
* Format:
  * Mobile: `050-123-4567` (`p.formatNational()`).
  * Landline: `03-555-1234`.
  * Non-IL: International format (`p.formatInternational()`).
* Always wrap the rendered phone in `<bdi dir="ltr">` or `<span dir="ltr">` to prevent bidirectional text glitches when mixed with Hebrew text.

### 3. Action Links
* **Call**: `<a href={"tel:" + phone}>` (keeps the normalized E.164 phone).
* **WhatsApp**: `<a href={"https://wa.me/" + phone.replace(/[^0-9]/g, "")}>` (clean digits without leading plus).
