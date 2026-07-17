# AJ-patrol-app

Patrol Officer (web) — **Login → live tracking on map → nearest SOS offered as “Accept / Decline” → after Accept, road route appears (same as dashboard) → Mark reached → next queued job.** History + messaging included.

## Run

```bash
cd patrol-officer-web
npm install
npm run dev
```

## Firebase

- `patrol_profiles/{uid}` → **`pid`** (must match `patrol_units/{pid}`).
- `patrol_assignments` — `pending_accept` until officer taps **Accept**, then `routing`.
- `patrol_units/{pid}` — live `live_lat` / `live_lng`.
- `admin_notifications/{uid}` — messages **from control room** (inbox).
- `patrol_to_admin` — messages **to control room** (dashboard Patrol tab lists these).

## Build

```bash
npm run build
```
