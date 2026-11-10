# Gearizo NAS job

Runs every 3 minutes next to the "Marketing Content" NAS share and talks to Supabase.

- **sync** (`nas_sync.py` + `nas_preview.py`): a new video in `Content Video/Checking` gets a small preview,
  becomes a new version of its item (matched by the GZ code in the file name, else by title) and is sent for
  review. When an item is approved / scheduled / posted, its file moves from Checking to `approve`.
- **autopost** (`autopost.py`): up to 23 h before a scheduled post, uploads the final file to Instagram Reels
  (a container the server publishes at the exact minute) and to the Facebook Page (a Reel Meta schedules).
  Status goes to the `postjobs` collection. Needs the Meta connection made in the app (Team > Social).

Settings live in a private JSON file on the computer that runs the job (see `settings.py`,
`config.example.json`). Turn each part on or off with `"sync"` and `"autopost"`.
**Only one computer may have `"autopost": true`**, or posts could upload twice.

## On a Mac
1. Copy this folder somewhere (e.g. `~/gearizo-nas`), put the filled-in settings at `~/.gearizo-secrets/supabase.json`.
2. Install ffmpeg (needed only for `sync`).
3. Run `python3 nas_sync.py` every 3 minutes with launchd. macOS only lets an app read network drives, so wrap
   the command in a small app (Script Editor: `do shell script "python3 ~/gearizo-nas/nas_sync.py"`, save as
   Application) and point the LaunchAgent at it; approve the network-volume prompt once.
4. The NAS share must stay mounted at `/Volumes/Marketing Content`.

## On the NAS (Docker)
1. UGOS Pro > App Center > install **Docker**.
2. Copy this folder to the NAS (e.g. `/volume1/docker/gearizo-nas`) and a filled-in `gearizo.json` to `/volume1/docker/gearizo`.
3. Docker > Project > Create from this folder's `docker-compose.yml`; fix the two left-hand paths; start it.
4. Logs: the container's log view (or `sync.log` in the data folder).

## Other pieces
- App: `index.html`, `app.js`, `runtime.js` (GitHub Pages). Server: `supabase/functions/notify/index.ts` (paste into
  Supabase > Edge Functions > notify > Code > Deploy). Database: `supabase/*.sql`.
