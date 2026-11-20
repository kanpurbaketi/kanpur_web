# Accounts, stages, languages, ads

## What players see
- **The game opens in the world**, with Ramu at Chhatrapati Shivaji chowk (the Shivaji Putla gate). There is no stage and no login needed: the player goes where they like.
  - A short loading page shows first, with no ad and no wait.
  - A message says where they are and how to start a stage.
- **The name at the top left:** "User" when logged out (clicking it opens the login), otherwise the username. Its ⓘ shows:
  - while roaming free: "Exploring", with a *Choose a stage* button;
  - in a stage: the stage's details, goal, status and time.
- **Stages** (menu → Stages, or ⓘ): 10 cards.
  - Stage 1 is open to everyone; the others are locked until the admin unlocks them for a player.
  - An unlocked stage that isn't built yet says "not ready yet".
  - Choosing a stage asks for a login (sign up / login / forgot password).
- **Starting a stage** reloads with `?stage=N`:
  - The loading page shows the stage name and the ad (when on), for at least 5 s.
  - Then the stage's **introduction** appears: what to do, and Start. Ramu waits until Start is pressed.
  - Then the **instructions**: one step at a time in a box at the top, with the distance to the next place.
- **Stage 1** always starts at the chowk:
  1. through the Shivaji Putla gate
  2. down the park road to the Nagar Nigam
  3. right at the Nagar Nigam
  4. in at the mela's gate, which records a completion
- **Language:** English or Hindi (menu → Settings). Only text changes; voices stay Hindi. The choice is kept in the browser and with the account.
- **If a stage can't start** (logged out, locked, not built), the game opens free with a message saying why.

## Admin (`admin.html`)
- Sign in with `ADMIN_USER` / `ADMIN_PASSWORD` (server environment).
- **Players:**
  - Search by username or email.
  - See details: joined, last login, language.
  - Unlock any stages.
  - Performance per stage: plays, time, completions, best time to finish, recent plays with distance and top speed.
- **Ads:** one switch for the loading page's ad, for everyone.
- **Game settings:** the existing crowd, Ramu and parts panels, still kept in that browser.

## Server
- **Vercel functions** in `api/`: `auth.ts`, `me.ts`, `admin.ts`, `config.ts`. Shared code is in `api/_lib/`. This is 4 functions, within Hobby's limit of 12.
- **Postgres** via `postgres`. The tables are made on first use: `users`, `email_codes`, `runs`, `settings`.
- **Sessions:** signed http-only cookies (`AUTH_SECRET`). Passwords are scrypt-hashed. Email codes are stored hashed, last 10 minutes, allow 5 tries, and can be resent after 45 s.
- **Email** goes through Brevo's API. If `EMAIL_TEST_CODE` is set (345678 for testing), every code is that and no email is sent.
- **In development**, `npm run dev` serves `/api` from the same files (vite.config.ts) using `.env`. For a local database, run `sh scripts/devdb.sh`.
- **Test scripts:** in development, `?debug` skips the loading page, and `?debug&stage=1` starts stage 1 without a login (not recorded).

## Deploying on Vercel
1. Import the repo. The framework preset is Vite; the build command is `npm run build` and the output is `dist`.
2. Storage → add **Neon** Postgres (free). It sets `DATABASE_URL`.
3. Environment variables (see `.env.example`):
   - `AUTH_SECRET`
   - `ADMIN_USER`, `ADMIN_PASSWORD`
   - `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME`
   - `EMAIL_TEST_CODE=345678` while testing (remove it to send real emails)
   - `ADSENSE_CLIENT` (ca-pub-…), `ADSENSE_SLOT`
4. **AdSense:** the site must be approved by Google first, and `public/ads.txt` needs the line Google gives.
