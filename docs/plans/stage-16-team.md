# Stage 16 — team: separate calendars for several people, no sign-in for them

Status: **design, approved by the owner in chat** (scope: separate calendars, no staff login; the four defaults below were accepted with "מאשר"). Written before any code (CLAUDE.md rule 1). Implementation starts only after the owner has read this file.

## Goal and non-goals
A business with more than one person (a barbershop with three chairs, a clinic with two therapists) can give each person their own working hours and services. A customer books with a named person or with "whoever is free"; the owner sees one agenda across everyone. A business with one person works exactly as today.

Out of scope on purpose: staff accounts and sign-in (only the owner/admins use the system), per-row permissions, invitations by mail, plan limits on the number of people (add `maxStaff` as an entitlement only after pricing is decided), per-person waitlist preference, shared rooms/equipment (`kind='room'` stays unused), CAT-07 packages.

## What exists and what changes
Already in the schema: `resources` (`kind` includes `staff`), `availability_rules`/`availability_exceptions` per `resource_id`, `appointments.resource_id` with the per-resource exclusion constraint (two people can never collide with themselves, two different people can overlap, which is exactly right).
The blocker is the assumption "one resource, the default one" that is written by hand into the latest versions of `public_catalog`, `public_book`, `create_manual_appointment_impl`, `waitlist_accept_impl` and the TS `loadAvailability`. Stage 16 replaces that assumption everywhere, with a test per path.

## Decisions
| # | Decision | Why |
|---|---|---|
| T1 | **Bookable people = every active resource of the business**, including the default one (the owner is a person too; its name is editable). At least one resource stays active. | no data migration of existing appointments, a one-person business is unchanged |
| T2 | **A service may be restricted to some people** (`service_staff`). A service with no rows = everybody can do it. | the simplest rule that covers "only Dana colours hair" |
| T3 | **The customer picks "whoever is free" (default) or a person.** The step "with whom?" appears only when the chosen service has two or more eligible people. | no extra step for one-person businesses |
| T4 | **Availability stays computed in one place (TS, `slots.ts`) and runs per person.** A time is offered when at least one eligible person is open and free. For the chosen slot TS passes the ordered candidate list (`p_resources uuid[]`) to the database, which tries them in order inside the existing retry loop; the exclusion constraint decides, so two simultaneous bookings for the same time go to two different people and the third gets `slot_taken`. | no second copy of the hours logic in SQL; the race protection already exists |
| T5 | **"Whoever is free" order = fewest appointments that day, then position.** Stored on the appointment as `resource_chosen = false`. | spreads the load, deterministic, testable |
| T6 | **Customer reschedule/cancel stay with the same person.** If the person is busy at the new time: `resource_chosen = false` may take another eligible free person, `true` may not (the slot is simply not offered). Changing the service uses the same eligibility rule. | the customer who asked for Dana is never silently handed to Noam |
| T7 | **Owner can move an appointment to another person** (move dialog gets a person selector, still audited and still "customer can cancel without conditions"). | real salons swap chairs |
| T8 | **Removing a person = deactivating** (`active=false`). Future appointments stay where they are and show a banner on the agenda ("3 upcoming appointments with Dana, who is no longer active: move or cancel"); nothing moves silently; the person disappears from public booking. The default resource can be deactivated only while another one is active. | deleting would orphan history and customer links |
| T9 | **Business-wide closures** (holidays) become exceptions with `resource_id is null` and apply to everybody; person-specific exceptions stay per person. Existing rows are backfilled to business-wide, because today they mean "the business". | otherwise adding a person would ignore the holidays |
| T10 | **Waitlist offers reserve the freed person's slot**: `waitlist_offers.resource_id` (backfilled with the default resource), `public_busy` returns the person, and an offer is made to entries whose service that person can do. Entries carry no person preference in v1. | keeps stage 13's "an offer holds the slot" correct per person |
| T11 | **Names are public** (first names appear on the booking page, the confirmation and reminders). The settings screen says so. Mail/preview text includes "with <name>" only in a business with two or more active people. | privacy by notice; no change for solo businesses |
| T12 | **Capability tokens do not change**: they carry the appointment id; the person is read server-side. | no token migration, no new scopes |
| T13 | **Bounds:** at most 30 people per business (database check), names 1–80 chars, writes only through audited definer RPCs `create_staff`, `update_staff`, `set_service_staff`, `set_staff_hours` (admin or owner), never raw table grants beyond today's `update(name, active)`. | abuse and tenancy guardrails of docs/05 |

## Scenarios (new ids, each needs a test at the lowest falsifying layer plus an E2E where wiring matters)
| ID | Behaviour | Layers |
|---|---|---|
| TEAM-01 | owner adds, renames, deactivates a person; limits (30, one active) enforced; audited | D, E |
| TEAM-02 | per-person weekly hours and exceptions; business-wide closure applies to all, person exception to one | D, U, E |
| TEAM-03 | service restriction: eligible set, empty set = everyone, cross-tenant ids refused | D, U |
| TEAM-04 | public slots = union over eligible open+free people; choosing a person narrows it | U, E |
| TEAM-05 | "whoever is free" assignment: fewest-that-day then position, deterministic | D, U |
| TEAM-06 | race: two customers, same time, two people → both succeed on different people; a third → `slot_taken`; one person, two customers → one wins | D (concurrent), E |
| TEAM-07 | customer reschedule/cancel keep the person; `chosen=false` may switch; `chosen=true` never | D, E |
| TEAM-08 | owner moves an appointment to another person; out-of-availability confirm still applies | D, E |
| TEAM-09 | deactivation: hidden from public, future appointments stay and are flagged, nothing moves silently | D, E |
| TEAM-10 | waitlist: freed slot offered per person, offer holds that person's slot, accept books on that person | D, E |
| TEAM-11 | agenda: all-people view with person on each row; per-person filter; mobile-360 usable; windows per person | E, A |
| TEAM-12 | notifications and digest name the person only in multi-person businesses | U, E |
| TEAM-13 | tenant isolation: RLS and RPCs refuse another business's people in every new function; `private.lint_violations()` stays empty | D, X |
| TEAM-14 | solo business regression: every existing spec passes unchanged | E (full suite) |

## Work order (each step ends with green local checks and a commit; CI per push)
1. **Database** (`20261034000000_team.sql`, forward-only): `resources.position`, bound check; `service_staff`; `availability_exceptions.resource_id` nullable + backfill; `appointments.resource_chosen`; `waitlist_offers.resource_id`; cross-tenant triggers; the four RPCs; `private.pick_resource`; `public_catalog` (people, eligibility, rules/exceptions per person), `public_busy` (+person), `public_book`/manual/accept take candidates; reschedule/move honour T6/T7. pgTAP `180_team.sql` with negative controls.
2. **Domain (TS):** `modules/team/*` (schemas, repo, service), `slots.ts` per person + union + candidate ordering, public/owner services and Zod contracts. Unit tests incl. property tests for the union and the ordering.
3. **Public booking UI:** the "with whom?" step, names in the confirmation and in `/booking/[token]`. E2E on mobile-360 + desktop, axe.
4. **Owner settings:** `/settings/team` (list, add, rename, hours, services, deactivate, public-name notice).
5. **Agenda:** all-people / per-person view, person on rows, orphaned-appointments banner, move dialog selector.
6. **Waitlist, notifications, digest, reschedule/move** wiring and their tests.
7. **Journey 8 (a three-chair day)** end to end, then `docs/evidence/stage-16.md`, launch checklist A7 + decision D25.

Evidence rule as in earlier stages: PASS/FAIL with the exact SHA, a negative control for each new guarantee, screenshots inspected, full suite on a fresh database, CI green per job.

## Risks
- Fifteen SQL functions carry the old assumption; a missed one would book on the default person only. Mitigation: a pgTAP that fails if any function body in `public`/`private` still contains `is_default` outside the allowed list.
- Existing E2E relies on the default resource; TEAM-14 runs the whole suite unchanged first (before the UI step) to prove the database step is invisible to solo businesses.
- Concurrency: candidate retry loop must not deadlock; reuse the stage 13 deadlock-to-`slot_taken` mapping and add a concurrent pgTAP/Playwright race.
