# Appointment Scheduling System

מערכת SaaS רב-דיירית לקביעת תורים לעסקים קטנים (בנייה מחדש של Project 8 על Supabase + Vercel).

## מסמכים (שלב התכנון)
1. [סיכום Project 8 ופיצ'רים](docs/01-project-8-summary.md)
2. [Engineering-OS — מה ניקח](docs/02-engineering-os-leverage.md)
3. [ארכיטקטורה, תוכנית שלבים והחלטות פתוחות](docs/03-architecture-and-plan.md)
4. [קטלוג תרחישים (133) ומיפוי לבדיקות ושלבים](docs/04-scenarios-catalog.md)
5. [ארכיטקטורת סייבר ואבטחת מידע](docs/05-security-architecture.md)

[יומן החלטות](docs/00-decisions.md)

## פיתוח מקומי
```bash
npm ci
npm run db:start                    # Supabase מקומי (Docker): DB, Auth, REST, מייל
cp .env.example .env.local          # ואז: source scripts/local-env.sh
npm run dev
```
בדיקות: `npm run check` (lint+types+unit) · `npm run build && npm run test:e2e` · `npm run db:test` · `npm run db:lint`.
כלים וסקילים: [docs/06-tooling-register.md](docs/06-tooling-register.md) · חוקי עבודה: [CLAUDE.md](CLAUDE.md).
