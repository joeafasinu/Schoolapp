# SchoolApp — Attendance & Results Management

A multi-school web app for daily attendance and results/broadsheet management.
Teachers enter scores and attendance from any device with a browser; the school
admin gets an auto-calculated broadsheet (exportable to Excel) and printable/
downloadable PDF report cards per pupil.

## What's included (Phase 1 MVP)

- Multi-school accounts — any school can sign up and gets its own isolated data
- Roles: Platform Admin (you), School Admin, Teacher
- Setup: classes, subjects, students, teacher-subject assignments, terms/sessions
- Score entry per teacher, per subject/class, with configurable components (CA1/CA2/Exam etc.)
- Auto-calculated broadsheet: totals, averages, class position — **exports to a clean .xlsx file**
- Individual student report card: printable page + **PDF download**, includes attendance summary and teacher/principal comments
- Daily attendance marking per class, feeding into the termly attendance summary on report cards

## Not yet included (see "Next steps" at the bottom)

- Automatic emailing/WhatsApp delivery of report cards to parents (the generation is done; delivery needs an email/WhatsApp API key from you)
- Billing/subscriptions for schools
- Password reset flow
- Bulk student import (currently one at a time via the form)

## Running it locally

Requirements: [Node.js](https://nodejs.org) 18+ and a Postgres database (local or hosted).

```bash
cd schoolapp
npm install
cp .env.example .env       # then edit DATABASE_URL to point at your Postgres
npm run seed                # creates tables and loads demo data (safe to skip on a fresh school)
npm start
```

Then open **http://localhost:3000**.

Don't have a local Postgres? Easiest options: `brew install postgresql` (Mac), a free instance on [Render](https://render.com) or [Neon](https://neon.tech), or Docker: `docker run -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres`.

### Demo logins (after running `npm run seed`)

| Role | Email | Password |
|---|---|---|
| School Admin | admin@brightfield.demo | admin123 |
| Teacher (Maths) | chinedu@brightfield.demo | teacher123 |
| Teacher (English) | funke@brightfield.demo | teacher123 |
| Teacher (Science) | tunde@brightfield.demo | teacher123 |
| Platform Admin (you) | owner@platform.com | owner123 |

To start completely fresh (no demo data), skip the seed script and go straight to `/signup` to register a real school.

## How a school actually uses it

1. School admin registers at `/signup` (or you create their account)
2. Admin sets up: **Terms** (starts the current term) → **Classes** → **Subjects** → **Students** → **Teachers** → assigns each teacher to their subject/class
3. Each morning, teachers log in and mark **Attendance** for their form class
4. Each term, subject teachers log in and enter scores under **Enter Scores**
5. Admin opens **Broadsheet** for a class — scores, totals, averages and positions are already calculated — and clicks **Export to Excel** for the school's records
6. Admin opens any student's **Report Card**, adds a comment if needed, and either prints it or downloads it as a PDF to send to the parent

## Data model / where things live

The app runs on Postgres (see `db/schema.sql`). Sessions are also stored in Postgres
(via `connect-pg-simple`), so logins survive restarts too — nothing depends on the
web server's local disk, which matters because most hosts (including Render web
services) treat that disk as temporary.

## Deploying it so it's live on the internet

This is a normal Node.js/Express app plus a Postgres database — deploys to any host that offers both.

**Render.com**
1. Push this folder to a GitHub repository
2. On Render: New → Postgres → create a database, copy its **Internal Database URL**
3. New → Web Service → connect the repo
   - Build command: `npm install`
   - Start command: `npm start`
   - Environment variables: `DATABASE_URL` (the Postgres URL from step 2), `SESSION_SECRET` (a long random string), `PGSSL=true` if using an *external* database URL from outside Render's network (internal URLs between Render services don't need it)
4. After the first deploy, run the seed script once from Render's shell tab (or locally against the same `DATABASE_URL`) if you want demo data: `npm run seed`

No persistent disk needed — Postgres holds all the state, so redeploys and restarts are safe.

## Project structure

```
schoolapp/
├── db/              # schema.sql, seed.js, index.js (Postgres pool + query helpers)
├── middleware/       # auth/session guards
├── routes/           # one file per feature area (auth, setup, scores, attendance, broadsheet, reportcard, platform)
├── views/             # EJS templates, organized by feature
├── public/css/        # single stylesheet
├── utils/grading.js   # broadsheet/position calculation logic
└── server.js           # app entry point
```

## Next steps for growth

1. **Report card delivery** — plug in an email provider (e.g., Resend, SendGrid) or WhatsApp Business API in `routes/reportcard.js`
2. **Subscription billing** per school (e.g., Paystack/Flutterwave for Naira billing, or Stripe)
3. **Bulk student import** via CSV upload instead of one-by-one entry
4. **Password reset flow**
