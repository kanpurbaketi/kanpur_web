# Accounts, stages, languages, ads

## What players see
- **Home** (no `?stage`): the name at the top left ("User" when logged out), Settings, Log in / Sign up, and 10 stage cards.
  - Stage 1 is open to everyone. The others are locked until the admin unlocks them for a player.
  - An unlocked stage that isn't built yet says "not ready yet".
- **Playing needs a login.** Clicking a stage while logged out opens the login.
- **Sign up:** username (unique, 3–20 letters, numbers, `_` or `.`), email, password, confirm password → *Send code* → the 6-digit code from the email → account made and signed in.
- **Login:** username or email, plus password. *Forgot password?* sends a code to the account's email, then asks for a new password; this signs out every other session.
- **Starting a stage** (`?stage=N`): a loading page for at least 5 s with the stage name and the ad (when on), while the world loads behind it.
- **In the game:**
  - The name sits at the top left, with an ⓘ that shows the stage's details, goal, status and time.
  - The menu has **Stages** and **Settings** (language, account).
- **Language:** English or Hindi (Settings). Only text changes; voices stay Hindi. The choice is kept in the browser and with the account.
- **Stage 1's goal:** starting at the Shivaji Putla gate, walk into the mela. Reaching it records a completion.

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
- **Test scripts:** `?debug` in development skips the home screen and the login.

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
