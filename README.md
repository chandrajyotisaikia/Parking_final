# Smart Parking Management System

A gate check-in app (with camera plate scanning) + desktop admin CRM (with login, income/expense tracking) + installable PWA.

## Run it locally (optional — you can skip straight to deployment)
```
npm install
npm start
```
Then open http://localhost:3000

## What's inside
- `server.js` — starts everything
- `routes/`, `controllers/`, `services/` — backend, organized so each piece has one job
- `db/db.js` — SQLite database, auto-creates itself on first run
- `public/` — everything the browser loads: gate page, admin CRM, styles, PWA files

## Admin dashboard
Open `/admin.html` — password is `LoginPwd` (this is a basic access gate, not real security — change it in `public/admin.js` if you want a different one).

## Deployment
See the deployment guide provided separately for step-by-step GitHub + Render instructions (100% free, no credits).

## Known limitation
Free hosting tiers (like Render's free plan) may reset the filesystem on redeploy/restart, which would clear the SQLite database. This is fine for testing and demos. If you go live with a real client long-term, ask about upgrading to a persistent database at that point — not urgent now.
