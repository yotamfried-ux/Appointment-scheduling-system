---
name: simulate-app-emails
description: >-
  Runs end-to-end simulations of all transactional application emails (Customer, Owner, Auth)
  by rendering templates and delivering them via the Resend API to a specified real email address.
  Use when the user asks to test, simulate, or visually inspect real application emails.
---

# Simulate Application Emails

Use this skill when you need to send and verify real emails across all system workflows.

## Workflow Steps

### 1. Catalog All Email Types (19 Application Templates)
* **Customer Notifications (10)**:
  * `booking_confirmed`, `booking_rescheduled`, `booking_cancelled_by_owner`, `booking_reminder`
  * `waitlist_joined`, `waitlist_offered`, `waitlist_expired`
  * `followup_review`, `business_broadcast`, `direct_message`
* **Owner Notifications (6)**:
  * `owner_new_booking`, `owner_booking_cancelled`, `owner_booking_rescheduled`
  * `owner_waitlist_joined`, `owner_daily_digest`, `owner_undelivered_alert`
* **Auth & Security (3)**:
  * `magic_link` / `sign_up_confirmation`, `reset_password`, `email_change`

### 2. Prepare Payload & Execution Script
Create a standalone script (`scripts/simulate-all-emails.mjs` or `.ts`) that:
* Loads environment variables (`RESEND_API_KEY`).
* Uses realistic Israeli dummy data (dates in Israel timezone, Hebrew names, barbershop/clinic services).
* Ensures `business.kind` is a valid identifier from `KIND_IDS` (e.g., `'barber'`, not `'barbershop'`).
* Formats footer branding consistently as **"ניהול יומן ותורים"**.

### 3. Execution & Delivery Tracking
1. Run the script via Node/tsx.
2. Collect the Resend email IDs returned from each send call.
3. Poll Resend status or inspect delivery logs to verify every single email reached status `DELIVERED`.
4. Provide a summarized table with Email Type, Subject, and Status.
