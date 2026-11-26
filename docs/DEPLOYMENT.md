# MediMate Deployment & Reliability Guide

This guide covers Firebase deployment (Firestore rules, composite indexes, Cloud Functions, Hosting), Render backend configuration, Render free-tier keep-alive options, Google Cloud Scheduler HTTP job triggers, and multi-timezone midnight closeout behavior.

---

## 1. Firebase Deployment (`medimate-e27da`)

### 1.1 Firestore Rules & Composite Indexes

The bounded 48-hour escalation query in `server/src/jobs/dueDosesEscalation.ts` and `functions/src/checkDueDosesAndEscalate.ts` filters `dose_logs` by `status in [...]` and `scheduledTime >= cutoffTimestamp`. Deploy `firestore.indexes.json` before deploying backend or Cloud Functions updates so the composite index `(status ASC, scheduledTime ASC)` is active:

```bash
npx firebase-tools deploy --only firestore:rules --project medimate-e27da
npx firebase-tools deploy --only firestore:indexes --project medimate-e27da
```

### 1.2 Cloud Functions v2

`firebase.json` deploys compiled artifacts from `functions/lib/`. Always run the TypeScript build inside `functions/` before deploying:

```bash
cd functions
npm install
npm run lint
npm run build
cd ..
npx firebase-tools deploy --only functions --project medimate-e27da
```

Exported scheduled functions:
- `generateDailyDoseLogs` (`0,30 * * * *` UTC)
- `closeMissedDoses` (`0,30 * * * *` UTC)
- `checkDueDosesAndEscalate` (`*/5 * * * *` UTC)

### 1.3 Frontend Hosting

```bash
npm run build
npx firebase-tools deploy --only hosting --project medimate-e27da
```

---

## 2. Render Automation Backend (`server/`)

`render.yaml` deploys `medimate-backend` (`runtime: node`, `rootDir: server`, `plan: free`, `healthCheckPath: /health`).

### 2.1 Required Environment Variables

| Variable | Value / Notes |
|---|---|
| `NODE_ENV` | `production` |
| `ENABLE_INTERNAL_CRON` | `"true"` to run `node-cron` inside the Render process, or `"false"` if triggering solely via Cloud Scheduler |
| `CRON_SECRET` | Auto-generated secret in Render; must match the `x-cron-secret` header sent by external schedulers |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Full JSON string of the Firebase Admin service account (`sync: false`, set in Render Dashboard) |

### 2.2 HTTP Endpoints

| Method & Path | Auth | Purpose |
|---|---|---|
| `GET /health` | None | Render health check; returns HTTP `200` `{ status: "ok", uptime, jobsActive }` |
| `GET /ping` | None | Lightweight keep-alive endpoint; returns HTTP `200` `{ ok: true, timestamp }` |
| `POST /api/jobs/generate-daily-logs` | `x-cron-secret` | Generates daily `dose_logs` (optional JSON body `{ "targetDate": "YYYY-MM-DD" }`) |
| `POST /api/jobs/check-due-doses` | `x-cron-secret` | Runs bounded 48h due/gentle/escalation check & FCM dispatch |
| `POST /api/jobs/close-missed-doses` | `x-cron-secret` | Transitions unresolved past-midnight doses to `missed` with `missedAt` |

---

## 3. Render Free-Tier Keep-Alive & Cloud Scheduler Setup

Render free-tier web services spin down after **15 minutes of inactivity**, which pauses internal `node-cron` schedules (`ENABLE_INTERNAL_CRON="true"`) until the next inbound HTTP request wakes the container. Choose either (or both) option below:

### Option A: External HTTP Keep-Alive Pinger (Simple)

Configure an external uptime monitor (e.g., UptimeRobot, cron-job.org, or GitHub Actions cron) to send an unauthenticated `GET` request every **5–10 minutes** to:

```text
https://<RENDER_SERVICE_URL>/ping
```

Expected response (`200 OK`):

```json
{ "ok": true, "timestamp": "2026-11-26T10:00:00.000Z" }
```

This keeps the Render instance warm so internal `node-cron` schedules (`0,30 * * * *` UTC and `*/5 * * * *` UTC) execute on time.

### Option B: Google Cloud Scheduler HTTP Jobs (Production-Grade)

Using Google Cloud Scheduler guarantees job execution even after container restarts or cold starts, and triggers `POST /api/jobs/*` directly with `x-cron-secret`:

```bash
# 1. Due doses & caregiver escalation check (every 5 minutes, UTC)
gcloud scheduler jobs create http medimate-check-due-doses \
  --location=asia-south1 \
  --schedule="*/5 * * * *" \
  --time-zone="UTC" \
  --uri="https://<RENDER_SERVICE_URL>/api/jobs/check-due-doses" \
  --http-method=POST \
  --headers="Content-Type=application/json,x-cron-secret=<CRON_SECRET>" \
  --message-body="{}"

# 2. EOD missed-dose closeout (every 30 minutes at :00/:30 UTC for global timezones)
gcloud scheduler jobs create http medimate-close-missed-doses \
  --location=asia-south1 \
  --schedule="0,30 * * * *" \
  --time-zone="UTC" \
  --uri="https://<RENDER_SERVICE_URL>/api/jobs/close-missed-doses" \
  --http-method=POST \
  --headers="Content-Type=application/json,x-cron-secret=<CRON_SECRET>" \
  --message-body="{}"

# 3. Daily dose log generation (every 30 minutes at :00/:30 UTC or 30 18 * * * UTC for IST)
gcloud scheduler jobs create http medimate-generate-daily-logs \
  --location=asia-south1 \
  --schedule="0,30 * * * *" \
  --time-zone="UTC" \
  --uri="https://<RENDER_SERVICE_URL>/api/jobs/generate-daily-logs" \
  --http-method=POST \
  --headers="Content-Type=application/json,x-cron-secret=<CRON_SECRET>" \
  --message-body="{}"

# 4. Optional keep-alive ping every 10 minutes
gcloud scheduler jobs create http medimate-render-ping \
  --location=asia-south1 \
  --schedule="*/10 * * * *" \
  --time-zone="UTC" \
  --uri="https://<RENDER_SERVICE_URL>/ping" \
  --http-method=GET
```

> **Security note**: Never commit `<CRON_SECRET>` or `FIREBASE_SERVICE_ACCOUNT_JSON` to source control. Always inject them via Render environment variables and Cloud Scheduler job headers.

---

## 4. Multi-Timezone Midnight Cycle & EOD Closeout Behavior

1. **Per-patient IANA Timezone (`users/{uid}.timezone`)**:
   - Each patient profile stores a valid IANA timezone (e.g., `Asia/Kolkata`, `America/New_York`). Missing or invalid values fall back to `Asia/Kolkata`.
   - Scheduled timestamps are computed using pure-JS `Intl.DateTimeFormat` with two-pass offset resolution so Daylight Saving Time (DST) transitions resolve accurately without external dependencies.
2. **Half-Hourly Midnight Cycle (`0,30 * * * *` UTC)**:
   - Covers both whole-hour offsets (e.g., UTC-05:00, UTC+00:00) and half-hour offsets (`Asia/Kolkata` UTC+05:30).
   - At each tick, `runMidnightTimezoneCycle` checks active patient timezones where local `hour === 0` (`00:00–00:59`). If none are in midnight hour, it exits early without scanning `dose_logs` or `medications`.
   - For active midnight-hour timezones, EOD closeout runs **before** daily log generation: non-terminal doses (`scheduled`, `due`, `snoozed`, `unconfirmed`) from earlier local dates (`scheduledDate < patientLocalToday` and `scheduledTime < now`) transition to `status: "missed"` with `missedAt` and `snoozeUntil: null`.
   - Daily `dose_logs` are then idempotently created for each midnight timezone's local date in batches of `<= 500`.
