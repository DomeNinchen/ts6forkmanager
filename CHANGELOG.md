# Changelog

Every user-visible or behaviour-affecting change of this fork, grouped by the month it shipped, newest month first. Each month lists new features, improvements, security changes and bug fixes, followed by upgrade notes (what an admin has to do when updating) and the update command. Entries are short on purpose: the linked pull request (or upstream issue) has the full story — root cause, design decisions and how the change was verified. Backend, frontend and sidecar are versioned independently, so each entry names the component versions that shipped it, and each month starts with the versions it ended on. Why this fork exists is explained in the [README](README.md#why-this-fork-exists).

## October 2026

Versions at the end of the month: **backend 2.73.0 · frontend 3.90.0 · sidecar 2.1.4**

### New Features

- **Execution list in the flow editor** — An **Executions** button opens a side panel with the flow's last 50 runs (running, completed, failed with the error, or dropped at the concurrency limit) and, on a click, the run's log line by line. It refreshes every 5 seconds while open; admins and bot operators see it. *backend 2.70.2, frontend 3.89.0* [#319](https://github.com/DomeNinchen/ts6forkmanager/pull/319)
- **Adjustable bot-flow concurrency limit** — How many executions of one flow may run at the same time (20 by default, 1 to 200) is set on the Bot Flows page, on the card now called **Executions: retention and limit**. *backend 2.70.0, frontend 3.88.0* [#317](https://github.com/DomeNinchen/ts6forkmanager/pull/317)
- **Play from the Music Request History** — The page gets a bot selector (the server's connected music bots) and **Play** / **Queue** buttons on every entry, next to the YouTube link. *frontend 3.87.0* [#314](https://github.com/DomeNinchen/ts6forkmanager/pull/314)
- **Restart notice** — While the manager restarts, for example during an update, open pages show a short notice and carry on by themselves once it is back: they reload if the update brought a new frontend, otherwise they only fetch fresh data. A host reverse proxy can show a self-reloading page instead of a bare 502 ([Deployment](https://github.com/DomeNinchen/ts6forkmanager/wiki/Deployment)). *frontend 3.86.0* [#305](https://github.com/DomeNinchen/ts6forkmanager/pull/305)
- **Reconfigurable template flows** — A flow created from a template gets a **Configure template** button that reopens the setup dialog with its values and rebuilds the flow. The Support System template takes several AFK channels. *backend 2.69.1, frontend 3.85.0* [#304](https://github.com/DomeNinchen/ts6forkmanager/pull/304)
- **Support System template, reworked** — A setup dialog for support channel, supporter groups, messages, an optional white-/blacklist and an optional waiting room. The flow creates a personal support room, counts supporters who are really online (an AFK channel can be left out), pokes the supporter groups or tells the user that nobody is there, and can rename a waiting room OPEN/CLOSED. Modelled on the SinusBot script by Mortis & Andreas Fink ([support-channel-mover](https://github.com/mortisdotpro/support-channel-mover), MIT). **Count Online in Groups** gains an "exclude channels" field. *backend 2.68.0, frontend 3.83.0* [#300](https://github.com/DomeNinchen/ts6forkmanager/pull/300)
- **Custom online user counts** — Per virtual server, leave chosen server groups and the manager's music bots out of the online number, separately for the dashboard (**Online count** button) and the embed widgets. Server capacity still counts every occupied slot. *backend 2.67.0, frontend 3.82.0* [#298](https://github.com/DomeNinchen/ts6forkmanager/pull/298)
- **Lounge layout** — Settings → WebGui offers Cockpit (the existing look, still the default) or Lounge: two-row top navigation, calmer typography and a dashboard that opens with a sentence instead of number tiles. New base themes Petrol and Chalk; with the red accent, delete actions turn orange. The open Settings tab is part of the address (`/settings?tab=webgui`). *backend 2.66.0, frontend 3.81.0–3.81.3* [#286](https://github.com/DomeNinchen/ts6forkmanager/pull/286), [#288](https://github.com/DomeNinchen/ts6forkmanager/pull/288), [#293](https://github.com/DomeNinchen/ts6forkmanager/pull/293)
- **Customisable dashboard** — Reorder, hide and resize the eight dashboard tiles. The layout is saved on the account and follows the user to every device. The widget button is renamed **Embed widgets**. *backend 2.64.0, frontend 3.78.0–3.79.0* [#278](https://github.com/DomeNinchen/ts6forkmanager/pull/278), [#279](https://github.com/DomeNinchen/ts6forkmanager/pull/279), [#280](https://github.com/DomeNinchen/ts6forkmanager/pull/280)
- **IP bans from the Connection Journal** — One click bans an address on the web interface (every request answered 403), on a TeamSpeak server, or both; a Bans tab lists and lifts them. Your own address and private networks cannot be banned, and an address an admin signed in from recently needs a second confirmation. `IP_BANS_DISABLED=true` switches web bans off. *backend 2.63.0, frontend 3.77.0* [#261](https://github.com/DomeNinchen/ts6forkmanager/pull/261)
- **Offline country lookup in the Connection Journal** — Downloads DB-IP's free country or city database (or takes your own MMDB file, e.g. MaxMind GeoLite2), with an optional monthly update. Lookups happen in the backend only, and older entries are filled in afterwards. *backend 2.62.0, frontend 3.76.0* [#259](https://github.com/DomeNinchen/ts6forkmanager/pull/259)
- **TeamSpeak joins in the Connection Journal** — One row per client connection with address, nickname, UID, version and session length, read live over SSH or by polling every 15 seconds. Query clients and the app's own bots are left out by default; each connection has a *Record who joins* switch. *backend 2.61.0, frontend 3.75.0* [#258](https://github.com/DomeNinchen/ts6forkmanager/pull/258)
- **Music bots pause when alone** — After a set number of minutes alone in their channel, and resume when someone returns. Switched on per bot with **Pause when alone** in the bot's settings; the minutes field appears once it is on (5 by default). Read from the bot's own voice connection, so it works without WebQuery. *backend 2.60.0, frontend 3.74.0, 3.86.2* [#257](https://github.com/DomeNinchen/ts6forkmanager/pull/257), [#313](https://github.com/DomeNinchen/ts6forkmanager/pull/313)
- **Connection Journal page** (Security, admins) — Records every web sign-in, 2FA step and SSO login with address, account and outcome, including rejected attempts. Retention and row cap are adjustable; a name that matches no account is stored as typed. *backend 2.59.0, frontend 3.73.0* [#256](https://github.com/DomeNinchen/ts6forkmanager/pull/256)
- **Idle video streams end by themselves** — After a set number of minutes without viewers (Settings → Streaming; 0 = never, the default). *backend 2.58.0, frontend 3.72.0* [#255](https://github.com/DomeNinchen/ts6forkmanager/pull/255)
- **`TRUST_PROXY` and Settings → Network** — Set how many reverse proxies (or which addresses) the backend trusts for the visitor's real address; the new page shows what the backend sees. *backend 2.57.0, frontend 3.71.0* [#254](https://github.com/DomeNinchen/ts6forkmanager/pull/254)
- **Music bot UID in its settings** — With a copy button. The UID is now derived the TS6 way (SHA-256); the bots' real IDs on the server do not change. *backend 2.56.0, frontend 3.70.0* [#253](https://github.com/DomeNinchen/ts6forkmanager/pull/253)
- **Voice-only server connections** — A connection can be added with just a name and a host, without an API key. Music bots work on it, and bot flows that need no WebQuery run; pages that need WebQuery are hidden, with notes where features are limited. *backend 2.55.0, frontend 3.69.0* [#251](https://github.com/DomeNinchen/ts6forkmanager/pull/251), [#252](https://github.com/DomeNinchen/ts6forkmanager/pull/252)
- **Channel icon in Edit Channel** — Set through the `i_icon_id` channel permission, since TS6 refuses `channel_icon_id`. A refusal names the missing permission. *backend 2.53.1, frontend 3.68.0* [#248](https://github.com/DomeNinchen/ts6forkmanager/pull/248)
- **Music bot connection status** — A bot's card shows connecting, the retry countdown, or why it failed (ban with reason and remaining time, flood protection, wrong password, full server). TS6 flood-protection refusals (error 3329) are retried slowly with bots taking turns, real bans stay final, and giving up after 10 retries is final until Start. *backend 2.52.2–2.53.0, frontend 3.67.0* [#245](https://github.com/DomeNinchen/ts6forkmanager/pull/245), [#246](https://github.com/DomeNinchen/ts6forkmanager/pull/246)
- **Automatic Groups mode on the Permissions page** (admins) — Add or remove permissions on all regular server groups of one auto-update type across the instance (`servergroupautoaddperm`/`servergroupautodelperm`), after a confirmation. *backend 2.51.0–2.51.1, frontend 3.65.0–3.65.1* [#238](https://github.com/DomeNinchen/ts6forkmanager/pull/238), [#239](https://github.com/DomeNinchen/ts6forkmanager/pull/239)
- **Files: folder upload and ZIP download** — Folder trees are created before their files; a folder downloads as one ZIP, streamed without temp files. *backend 2.50.0, frontend 3.64.0* [#235](https://github.com/DomeNinchen/ts6forkmanager/pull/235)
- **Files: picture preview** — PNG, JPEG, GIF, BMP and WebP up to 10 MiB, with arrow keys through the folder. The type is recognised by the file's bytes, never by its name. *backend 2.49.0, frontend 3.63.0* [#234](https://github.com/DomeNinchen/ts6forkmanager/pull/234)
- **Files: upload window** — Files are reviewed before sending. Names with umlauts or other non-ASCII characters are flagged (TeamSpeak clients may fail to download them) and can be converted to ASCII per file or all at once. *frontend 3.61.2–3.62.0* [#231](https://github.com/DomeNinchen/ts6forkmanager/pull/231), [#232](https://github.com/DomeNinchen/ts6forkmanager/pull/232)
- **Query Console: live events** — Listen to server, channel, chat and ban events over a shared SSH session and save them as text or JSON. *backend 2.48.0, frontend 3.61.0* [#229](https://github.com/DomeNinchen/ts6forkmanager/pull/229)
- **Files: upload and download** — Uploads go through a temp file and replace the target only when complete; downloads are one-time links that stream to disk. The size limit is `FILES_MAX_UPLOAD_MB` (default 100). *backend 2.47.0, frontend 3.60.0* [#228](https://github.com/DomeNinchen/ts6forkmanager/pull/228)
- **Query Console page** (System, admins) — Run any ServerQuery command with autocomplete and help for all 149 documented commands, with results as tables. 17 destructive commands must be confirmed by typing their name, secrets are masked, every command goes to an audit log, and a flood guard keeps the app under TeamSpeak's limit. *backend 2.46.0, frontend 3.59.0* [#227](https://github.com/DomeNinchen/ts6forkmanager/pull/227)
- **History charts for users, bandwidth and ping** — Statistics gets a History tab (24 hours to 31 days) with outages and stopped periods marked, an optional slot-limit line, and per-connection *Record history* plus interval and retention settings. The Dashboard shows the last 24 hours of users. *backend 2.42.0–2.45.0, frontend 3.55.0–3.58.0* [#222](https://github.com/DomeNinchen/ts6forkmanager/pull/222), [#225](https://github.com/DomeNinchen/ts6forkmanager/pull/225), [#226](https://github.com/DomeNinchen/ts6forkmanager/pull/226)
- **Client Database page** (admins) — Every client profile, offline ones included, with search, details, ban by UID/name/IP, delete, a group mode to toggle server-group membership, selectable columns, and export as CSV, HTML or JSON. *backend 2.41.0–2.43.0, frontend 3.54.0–3.56.0* [#221](https://github.com/DomeNinchen/ts6forkmanager/pull/221), [#223](https://github.com/DomeNinchen/ts6forkmanager/pull/223)

### Improvements

- **Interrupted flow executions** — An execution cut off by a backend restart, crash or shutdown no longer stays "running" forever: the flow editor's execution list shows it as **Interrupted**, with the node it had started last. On a regular stop or update, executions busy with a node get up to 5 seconds to finish; one waiting in a Delay does not hold the stop up, is marked interrupted and does not continue after the restart. *backend 2.73.0, frontend 3.90.0*
- **Versioned database migrations** — The backend keeps its database schema in versioned Prisma migrations and applies the pending ones on start, instead of forcing the schema into shape on every start. A new install is built from the migrations; a database from before this change is adopted into the migration history on the first start after updating (its schema is checked first, and a mismatch stops the start rather than altering data). Destructive schema changes now ship as reviewed migration files, and the database backup before a schema change still runs. ([Troubleshooting](https://github.com/DomeNinchen/ts6forkmanager/wiki/Troubleshooting)) *backend 2.72.0* [#321](https://github.com/DomeNinchen/ts6forkmanager/pull/321)
- **Database backup before schema changes** — When a container start would change the database schema (an update that adds, alters or removes columns), the backend first copies the database to `data/backups/` on the `backend-data` volume and only then syncs the schema. The newest 5 copies are kept (`DB_BACKUP_KEEP`); if the copy cannot be written, the container stops before the sync. Starts without a schema change take no copy. ([Troubleshooting](https://github.com/DomeNinchen/ts6forkmanager/wiki/Troubleshooting)) *backend 2.71.0* [#320](https://github.com/DomeNinchen/ts6forkmanager/pull/320)
- **Music request history keeps the last 25 songs** — Per server, for `!play`, `!queue` and songs started from the web interface; older entries are deleted. The play dialog's history tab and the Music Request History page show the same 25. *backend 2.69.4, frontend 3.87.0* [#314](https://github.com/DomeNinchen/ts6forkmanager/pull/314)
- **Music bots decode songs while they play** — A song no longer sits in memory as a whole: a 26-minute mix used to take about 300 MB per bot (twice that while loading) and several seconds before the first note. Now each playing bot needs only its decoder (about 50 MB, like a radio bot), whatever the song's length, and starts within a fraction of a second. Seeking during playback leaves a short gap of about 65 ms. *backend 2.69.3* [#311](https://github.com/DomeNinchen/ts6forkmanager/pull/311)
- **Smoother music bot playback on slow disks** — The database runs in SQLite's WAL mode, so background writes (such as the dashboard's bandwidth samples every 30 seconds) no longer hold up a bot's audio for up to a tenth of a second. *backend 2.69.2* [#309](https://github.com/DomeNinchen/ts6forkmanager/pull/309)
- **Compose files without `version:`** — Both compose files drop the unused `version: '3.8'` line, so Docker Compose v2 stops warning that it is obsolete; the stack itself is unchanged. [#308](https://github.com/DomeNinchen/ts6forkmanager/pull/308)
- **Template layouts** — Bot-flow templates are laid out without crossing or overlapping lines (Support System, Private Channel Creator, Anti-VPN, Bad Name Checker, Group Protector), for new template flows and for those rebuilt with **Configure template**. *frontend 3.86.1* [#306](https://github.com/DomeNinchen/ts6forkmanager/pull/306)
- **Music bot queue plays and empties itself** — Adding a song to an idle bot starts it, and "Load & play" on a playlist really plays it. Played tracks leave the queue (**Previous** still steps back through the last 50), a stopped bot with tracks left gets a **Play queue** button, and starting a track from the queue plays it right away without skipping the ones ahead. The player widget's "Up next" no longer lists the current track. *backend 2.69.0, frontend 3.84.0* [#302](https://github.com/DomeNinchen/ts6forkmanager/pull/302)
- **Bot-flow history cleanup** — Execution history is kept for 30 days and at most 50,000 rows per table by default, adjustable on the Bot Flows page. *backend 2.65.0, frontend 3.80.0* [#284](https://github.com/DomeNinchen/ts6forkmanager/pull/284)
- **Lounge customise mode** — Marks the four number tiles that the Lounge sentence replaces instead of offering a switch that did nothing. *backend 2.67.0, frontend 3.82.0* [#298](https://github.com/DomeNinchen/ts6forkmanager/pull/298)
- **Smaller backend image** — No longer ships the frontend's build toolchain (528 → 368 packages, 2083 → 1827 MiB). *backend 2.63.2* [#263](https://github.com/DomeNinchen/ts6forkmanager/pull/263)
- **Connection changes take effect everywhere at once** — Creating, editing, disabling or deleting a server connection reaches bot flows, music bots, live listeners and samplers without a backend restart. *backend 2.54.0* [#250](https://github.com/DomeNinchen/ts6forkmanager/pull/250)
- **No third-party requests from the web interface** — Fonts are bundled instead of loaded from Google Fonts. An optional, informational storage notice can be switched off under Settings → WebGui. *backend 2.52.0, frontend 3.66.0* [#242](https://github.com/DomeNinchen/ts6forkmanager/pull/242)
- **Update command with `--autostash`** — The update banner's command is now `git pull --autostash && docker compose up -d --build`, so local edits to `docker-compose.yml` no longer block the pull. *frontend 3.61.1* [#230](https://github.com/DomeNinchen/ts6forkmanager/pull/230)

### Security

- **Execution logs only through their own flow** — A flow's execution log can now only be read through the flow it belongs to, so access to one server's flows no longer gives access to the logs of another server's flows. *backend 2.70.2* [#319](https://github.com/DomeNinchen/ts6forkmanager/pull/319)
- **Dependency update** — `ip-address` 10.7.4 (pulled in by `express-rate-limit`) closes one Dependabot alert; it was not reachable in this app. *backend 2.69.6* [#316](https://github.com/DomeNinchen/ts6forkmanager/pull/316)
- **Secrets masked in the query debug log** — With the "query" debug flag on, passwords, API keys, privilege keys, file-transfer keys and other credentials in logged WebQuery and SSH commands and answers are written as `***`; the log and the query console share one list of secret fields, which now also covers `jwt`. *backend 2.69.5, frontend 3.87.1* [#315](https://github.com/DomeNinchen/ts6forkmanager/pull/315)
- **Dependency updates** — `follow-redirects` 1.16.1 (pulled in by `axios`) and `vite` 8.3.4 close three Dependabot alerts; none was reachable in this app. *backend 2.68.1, frontend 3.83.2* [#303](https://github.com/DomeNinchen/ts6forkmanager/pull/303)
- **No privilege keys from bot flows** — `tokenadd` and `tokenlist` are removed from the WebQuery action's allow-list. *backend 2.66.3* [#291](https://github.com/DomeNinchen/ts6forkmanager/pull/291)
- **Refresh token reuse detection** — A refresh token used a second time ends that whole login. *backend 2.66.2, frontend 3.81.2* [#290](https://github.com/DomeNinchen/ts6forkmanager/pull/290)
- **Operators stay on their own servers** — Music and bot operators can no longer create bots on, or delete, play, queue or playlist songs and stations of server connections they were not granted. Songs and stations are deleted only through their own server. *backend 2.66.1* [#289](https://github.com/DomeNinchen/ts6forkmanager/pull/289)
- **Outgoing requests stay on the public internet** — Bot-flow HTTP/webhook actions, radio and video URLs and yt-dlp: every redirect hop and every resolved address is checked; IPv6 literals, IPv4-mapped forms, carrier-grade NAT, multicast and reserved ranges count as private; an unresolvable host is refused; yt-dlp gets `--` before the URL and only public `http(s)` URLs. Also adds the repo's first automated test (`pnpm test`). *backend 2.64.2, 2.65.1, 2.66.1* [#283](https://github.com/DomeNinchen/ts6forkmanager/pull/283), [#285](https://github.com/DomeNinchen/ts6forkmanager/pull/285), [#289](https://github.com/DomeNinchen/ts6forkmanager/pull/289)
- **Non-root containers** — No container runs as root any more; a one-shot `volume-init` service hands existing volumes to uid 1000. *backend 2.63.10, sidecar 2.1.3, frontend 3.77.8* [#276](https://github.com/DomeNinchen/ts6forkmanager/pull/276)
- **Leaner, patched container images** — Backend and sidecar are built on Debian 13 (ffmpeg 7.1). The backend image drops curl, unzip, pnpm, npm and other unused tools, the frontend image installs pending Alpine patches, all three have a `HEALTHCHECK`, and the Trivy scan runs weekly. *backend 2.63.9, sidecar 2.1.2, frontend 3.77.7* [#273](https://github.com/DomeNinchen/ts6forkmanager/pull/273), [#274](https://github.com/DomeNinchen/ts6forkmanager/pull/274), [#275](https://github.com/DomeNinchen/ts6forkmanager/pull/275)
- **Role checks on every read, deny by default** — Viewers and operators can no longer read admin-only data through the API (privilege keys, temporary passwords, bans, server logs, client IPs, permissions and more). Every route mount refuses non-admin roles unless a request is explicitly listed, the two "recheck" endpoints are admin-only, and WebSocket events reach only users with the right role and server access. *backend 2.63.4–2.63.8, frontend 3.77.4–3.77.6* [#267](https://github.com/DomeNinchen/ts6forkmanager/pull/267), [#271](https://github.com/DomeNinchen/ts6forkmanager/pull/271), [#272](https://github.com/DomeNinchen/ts6forkmanager/pull/272)
- **Sidecar port 9800 no longer published on the host** — Its unauthenticated API is only reachable inside the Docker network. *sidecar 2.1.1* [#268](https://github.com/DomeNinchen/ts6forkmanager/pull/268)
- **Dependency updates** — `proxy-addr` 2.0.8 (could trust every address with a short IPv4-mapped `TRUST_PROXY` range) and `source-map-js` 1.2.2 (build-time only) close two Dependabot alerts. *backend 2.63.1, frontend 3.77.1* [#262](https://github.com/DomeNinchen/ts6forkmanager/pull/262)
- **Backend port published on `127.0.0.1` only** — *backend 2.57.0* [#254](https://github.com/DomeNinchen/ts6forkmanager/pull/254)
- **Dependency updates** — `multer`, `ip-address`, `fast-uri` and `deepmerge-ts` close five Dependabot alerts; none was reachable from outside. *backend 2.51.2* [#240](https://github.com/DomeNinchen/ts6forkmanager/pull/240)
- **Files routes admin-only** — *backend 2.47.0* [#228](https://github.com/DomeNinchen/ts6forkmanager/pull/228)
- **Client database routes admin-only** — They exposed clients' last IPs. *backend 2.41.0* [#221](https://github.com/DomeNinchen/ts6forkmanager/pull/221)

### Bug Fixes

- Fixed a bot flow exceeding its concurrency limit after being switched off and on (or saved) while executions were still running; those executions now keep counting until they end. *backend 2.70.1* [#318](https://github.com/DomeNinchen/ts6forkmanager/pull/318)
- Fixed bot-flow triggers beyond the concurrency limit being dropped silently while a webhook still answered `triggered`; the webhook now counts only started executions and reports `dropped` separately, and the flow's card on the Bot Flows page shows how many triggers were dropped in the last 24 hours. *backend 2.70.0, frontend 3.88.0* [#317](https://github.com/DomeNinchen/ts6forkmanager/pull/317)
- Fixed **Play** in the play dialog's history tab looking as if it did nothing: a song that is not downloaded yet takes several seconds to load, and the clicked button now shows a spinner until it starts. *frontend 3.87.0* [#314](https://github.com/DomeNinchen/ts6forkmanager/pull/314)
- Fixed other music bots stuttering for a moment whenever one bot started a long song, and a song staying in memory after the queue had ended or for as long as it was paused. *backend 2.69.3* [#311](https://github.com/DomeNinchen/ts6forkmanager/pull/311)
- Fixed temporary channels created by bot flows staying forever because the bot's own query connection sat in them; the bot now leaves once the user is moved in, and two support requests at the same moment both get their room. *backend 2.69.1* [#304](https://github.com/DomeNinchen/ts6forkmanager/pull/304)
- Fixed the page's language tag always saying German; it now names the interface language actually shown, so screen readers pronounce it correctly and browsers stop offering to translate. *frontend 3.83.1* [#301](https://github.com/DomeNinchen/ts6forkmanager/pull/301)
- Fixed music bots showing zeros in TeamSpeak's connection info; ping, packets, bytes and bandwidth are real now. *backend 2.66.6* [#297](https://github.com/DomeNinchen/ts6forkmanager/pull/297)
- Fixed short crackles in music bot playback: when the backend was briefly busy, a bot skipped a few milliseconds and paused for one extra frame. It now catches up on the late frames, for songs, `!play` links and radio alike. *backend 2.66.5* [#296](https://github.com/DomeNinchen/ts6forkmanager/pull/296)
- Fixed five small backend issues: a YouTube download shared by several servers' libraries was deleted while another entry still used it; `JWT_REFRESH_EXPIRY` was ignored (`7d`, `12h`, … now apply); wrong uploads got 500 instead of 413/400; simultaneous widget visitors each triggered a TeamSpeak fetch; the first-admin setup could create two admins. *backend 2.66.4* [#292](https://github.com/DomeNinchen/ts6forkmanager/pull/292)
- Fixed logouts when the access token expired: a page and all tabs of a browser now share one token refresh, and a backend restart no longer logs anyone out. *backend 2.66.2, frontend 3.81.2* [#290](https://github.com/DomeNinchen/ts6forkmanager/pull/290)
- Fixed the sidecar image build with Docker's legacy builder. *sidecar 2.1.4* [#287](https://github.com/DomeNinchen/ts6forkmanager/pull/287), reported in [#282](https://github.com/DomeNinchen/ts6forkmanager/issues/282)
- Fixed unreadable request bodies being answered with "500 Internal server error"; they now get 400, 413 or 415. *backend 2.64.1* [#281](https://github.com/DomeNinchen/ts6forkmanager/pull/281)
- Fixed Offline Messages: senders appear by nickname, a message's text loads when opened, the read state is correct, and opening a message marks it read. A hint explains that the list is the inbox of the manager's own query login. *backend 2.63.3–2.63.6, frontend 3.77.3–3.77.5* [#266](https://github.com/DomeNinchen/ts6forkmanager/pull/266), [#270](https://github.com/DomeNinchen/ts6forkmanager/pull/270)
- Fixed the Instance page's "Flood Ban Time" not saving; it edits the property TS6 really has (`serverinstance_serverquery_ban_time`). Save stays disabled without a real change, and the API answers 400 for unknown or empty settings instead of a silent "ok". *backend 2.63.5, frontend 3.77.2* [#265](https://github.com/DomeNinchen/ts6forkmanager/pull/265), [#269](https://github.com/DomeNinchen/ts6forkmanager/pull/269)
- Fixed the video tab's empty-queue hint showing a literal `&lt;url&gt;`. *frontend 3.76.1* [#260](https://github.com/DomeNinchen/ts6forkmanager/pull/260)
- Fixed pausing a radio stream by hand. *backend 2.60.0, frontend 3.74.0* [#257](https://github.com/DomeNinchen/ts6forkmanager/pull/257)
- Fixed deleting a server connection whose flows have run. *backend 2.54.0* [#250](https://github.com/DomeNinchen/ts6forkmanager/pull/250)
- Fixed bulk permission edits: with several entities selected, the Permissions page shows the shared value or "mixed", removing a permission from all of them works, and a cleared field no longer jumps to 0. *frontend 3.67.1–3.68.1* [#247](https://github.com/DomeNinchen/ts6forkmanager/pull/247), [#249](https://github.com/DomeNinchen/ts6forkmanager/pull/249)
- Fixed embedding widgets on other sites: the live `/widget/` iframe and the SVG/PNG widget images work again. *backend 2.52.1, frontend 3.66.1* [#243](https://github.com/DomeNinchen/ts6forkmanager/pull/243), [#244](https://github.com/DomeNinchen/ts6forkmanager/pull/244)
- Fixed music bots dropping with `EAI_AGAIN` on slow DNS resolvers; they resolve the server's hostname once per connection instead of once per voice packet. *backend 2.51.3* [#241](https://github.com/DomeNinchen/ts6forkmanager/pull/241)
- Fixed the SSH ServerQuery client never retrying after a failed reconnect. *backend 2.48.0* [#229](https://github.com/DomeNinchen/ts6forkmanager/pull/229)
- Fixed folders and files shown the wrong way round on the Files page. *backend 2.47.0, frontend 3.60.0* [#228](https://github.com/DomeNinchen/ts6forkmanager/pull/228)
- Fixed ServerQuery unescaping (`tsUnescape`). *backend 2.46.0* [#227](https://github.com/DomeNinchen/ts6forkmanager/pull/227)
- Fixed the Add Connection dialog not saving the "Dashboard Ping Target". *backend 2.42.1* [#224](https://github.com/DomeNinchen/ts6forkmanager/pull/224)

### Upgrade Notes

**Docker & reverse proxy**

- The frontend container listens on **8080** instead of 80 (`docker-compose.yml` publishes `3000:8080`). A Coolify domain or a proxy that talks to the container directly must switch from 80 to 8080. [#276](https://github.com/DomeNinchen/ts6forkmanager/pull/276)
- Bind mounts need `chown -R 1000:1000`, and a mounted `YT_COOKIE_FILE` must be writable for uid 1000. [#276](https://github.com/DomeNinchen/ts6forkmanager/pull/276)
- Behind a host nginx or Coolify proxy in front of the frontend container, set `TRUST_PROXY=2`. The backend port is now published on `127.0.0.1` only. [#254](https://github.com/DomeNinchen/ts6forkmanager/pull/254)
- The sidecar's port 9800 is no longer published on the host; only containers in the Docker network reach it. [#268](https://github.com/DomeNinchen/ts6forkmanager/pull/268)
- The backend image has no curl any more. Check the sidecar with `docker compose exec backend node -e "fetch('http://ts6-sidecar:9800/health').then(r=>r.text()).then(console.log)"`. [#273](https://github.com/DomeNinchen/ts6forkmanager/pull/273)
- If you edited the first lines of your `docker-compose.yml`, the next `git pull --autostash` reports a conflict there, resolved the same way as [the port line](https://github.com/DomeNinchen/ts6forkmanager/wiki/Deployment#running-unprivileged). [#308](https://github.com/DomeNinchen/ts6forkmanager/pull/308)

**Backups**

- Before each start that changes the schema, a copy of the database lands in `data/backups/` on the `backend-data` volume, readable only by the backend user; keep it private, as it holds password hashes and encrypted credentials. Plan room for `DB_BACKUP_KEEP` (default 5) copies of the database's size. A copy is only useful together with the `ENCRYPTION_KEY` (or `JWT_SECRET`) from your `.env`. Both compose files gain the optional `DB_BACKUP_KEEP` line. [#320](https://github.com/DomeNinchen/ts6forkmanager/pull/320)
- Back up the whole `data/` directory as before; it now also holds the `ts6webui.db-wal` and `ts6webui.db-shm` files. [#309](https://github.com/DomeNinchen/ts6forkmanager/pull/309)

**Database**

- The first start after this update adopts your existing database into the new migration history (a one-time, automatic baseline) and writes a backup to `data/backups/` beforehand; no action is needed, and all your data is kept. Schema changes are applied as versioned migrations from now on. If a start ever reports a schema mismatch it stops instead of changing data — restore from `data/backups/` and check the logs. ([Troubleshooting](https://github.com/DomeNinchen/ts6forkmanager/wiki/Troubleshooting)) [#321](https://github.com/DomeNinchen/ts6forkmanager/pull/321)

**Bot flows & music bots**

- Stopping or updating the backend can take up to 5 seconds longer while flow executions finish their current step. Executions that earlier restarts left on "running" show as **Interrupted** after the first start.
- External callers of a bot-flow webhook can now get **429** (with `Retry-After: 5`) when every flow on that path is already running its maximum number of executions; the answer is `{ "triggered": n, "dropped": m }` instead of `{ "triggered": n }`. Unknown paths and wrong secrets still get 404. [#317](https://github.com/DomeNinchen/ts6forkmanager/pull/317)
- The music request history keeps only the newest 25 entries per server; older ones are deleted with the next request. [#314](https://github.com/DomeNinchen/ts6forkmanager/pull/314)
- Flows that use `tokenadd` or `tokenlist` now stop at that step with an error in their log. [#291](https://github.com/DomeNinchen/ts6forkmanager/pull/291)
- **Configure template** replaces hand-made node changes in that flow. [#304](https://github.com/DomeNinchen/ts6forkmanager/pull/304)
- The "repeat queue" mode is gone; repeat track stays. [#302](https://github.com/DomeNinchen/ts6forkmanager/pull/302)

**Authentication**

- Update backend and frontend together. [#290](https://github.com/DomeNinchen/ts6forkmanager/pull/290)

### Updating

For installations built from the Git repository, after reading the upgrade notes above:

```bash
git pull --autostash && docker compose up -d --build
```

## September 2026

Versions at the end of the month: **backend 2.40.2 · frontend 3.53.0 · sidecar 2.1.0**

### New Features

- **French translation** — The first language to arrive through Crowdin. *frontend 3.53.0* [#214](https://github.com/DomeNinchen/ts6forkmanager/pull/214)
- **Community translation via Crowdin** — New languages arrive as PRs, and the language list is built from the locale files that exist. *backend 2.40.0, frontend 3.52.0* [#209](https://github.com/DomeNinchen/ts6forkmanager/pull/209)
- **German translation of the whole web interface** — Chosen per account under Settings → WebGui. *backend 2.39.0, frontend 3.51.0* [#208](https://github.com/DomeNinchen/ts6forkmanager/pull/208)
- **Autoplay on Connect** — A music bot can start a chosen song or radio station whenever it connects idle. *backend 2.38.0, frontend 3.50.0* [#207](https://github.com/DomeNinchen/ts6forkmanager/pull/207)
- **Play files from the Library tab** — Play/Add to Queue for audio, Stream/Add to Stream Queue for video, with a bot picker. *frontend 3.49.0* [#204](https://github.com/DomeNinchen/ts6forkmanager/pull/204)
- **Group icons** — Everywhere a group is listed or picked, plus a live preview and visual picker for `i_icon_id` on the Permissions page. *frontend 3.47.0*
- **Role-based permissions for music chat commands** — A Permissions tab on Music Bots restricts each command to server groups, with admin-bypass groups. *backend 2.36.0–2.36.1, frontend 3.46.0–3.46.1* — requested in [#184](https://github.com/DomeNinchen/ts6forkmanager/issues/184)
- **Optional GitHub API token for the update check** (Settings → Update Status) — Raises GitHub's limit from 60 to 5,000 requests per hour. Without it, "Recheck Now" is limited to 20 per hour. *backend 2.35.0, frontend 3.45.0*
- **Icon Browser page** (Content) — The server's icon pool as a gallery, with upload (checked by content and against `i_max_icon_filesize`) and delete (with a warning where an icon is in use). *backend 2.34.0, frontend 3.44.0*
- **Nine base themes and ten accents** — With a working light mode; the header's sun/moon button swaps between your last light and dark theme. *backend 2.33.0, frontend 3.43.0*
- **Permissions: Set Multiple and Import File** — Set or remove values on many permissions at once, and apply an exported group file to any selection (Merge or Replace). *frontend 3.42.0*
- **Edit Channel dialog with tabs** — Description, codec, encryption, client limits, channel type and delete delay, default channel, talk power, sort order, phonetic name and banner, with values loaded fresh. *frontend 3.41.0*
- **Play and Queue in the Play Music dialog** — For History entries, like chat's `!play`; queueing while idle starts playback. *backend 2.32.0, frontend 3.39.0*
- **Video stream start volume** — Streams start at 10 % of the source's volume, adjustable under Settings → Streaming. *sidecar 2.1.0, backend 2.31.0, frontend 3.36.0*
- **Video stream queue** — `!stream` during a stream queues the video; `!streamqueue` and `!streamskip` are new, and the web interface has Queue/Switch now and an Up Next panel. *backend 2.30.0, frontend 3.35.0*
- **Higher streaming quality presets** — Up to 1080p at 6000k/60fps, the new default. Settings → Streaming sets what a bare `!stream` uses. *backend 2.29.0, frontend 3.34.0*
- **Permissions: Permission Overview** — Pick a client and a channel to see every permission that applies and which layer wins, including the Skip flag, in the order the server's own documentation gives. *frontend 3.33.0–3.33.1*
- **Channel Groups "By Client" for several channels at once** — Dropdowns only offer assignable groups. *frontend 3.32.0*
- **Permissions: Find Permission** — A reverse lookup of where a permission is set across all five layers, with values; a click opens the entry. *backend 2.28.0, frontend 3.31.0*
- **Permissions: Advanced/Simple toggle** — Between raw permission names and TeamSpeak's plain descriptions. *frontend 3.30.0*
- **Permissions: Compare mode** — For two or more entities of one layer: a side-by-side table, editable cell by cell, with "Only show differing", an Add/Remove Perm dialog, exported group files as extra columns, and automatic or click-to-pin colouring. *frontend 3.22.0–3.29.0*
- **Tokens: Create Token dialog** — For privilege keys (copied to the clipboard), offering only assignable groups. *frontend 3.27.0*
- **Server and Channel Groups: Delete Selected, Export and Import** — Exports a JSON of the groups' permissions and imports it as new groups. Channel Groups also get a Create button. *frontend 3.25.0–3.26.0*
- **Tokens: Temporary Passwords**, and a **Channel Groups "By Client" tab**. *backend 2.27.0, frontend 3.24.0*
- **Permissions: "Client in Channel" layer** — Channel-client permissions, wired into Bulk Apply and Compare. *backend 2.26.0, frontend 3.23.0*
- **Files: move a file to another channel.** *backend 2.25.0, frontend 3.21.0*
- **Permissions: Bulk Apply** — When several entities are selected. *frontend 3.20.0–3.23.1*
- **Server Logs: pagination, instance log, Add Entry, export** — To `.txt`/`.html`; line counts are limited to the valid 1–100. *backend 2.24.0, frontend 3.19.0*
- **Channels: multi-select with Edit Selected** — Creating several channels at once (one name per line), and "Use as template". *frontend 3.18.0*
- **Clients: multi-select** — With bulk Move, Kick, Ban and Describe. *backend 2.21.0, frontend 3.16.0*
- **Advanced Settings page** — The virtual server's own properties (welcome message, banner, default groups, password, security level, reserved slots, anti-flood, logging, file-transfer quotas and more), plus an IP Bindings card on the Instance page. *backend 2.19.0, frontend 3.15.0*
- **Bot Flow text editor: Show Placeholders panel** — And a Templates tab in the placeholder reference. *frontend 3.12.0*
- **OLED Black base theme** — Alongside the default navy. *backend 2.16.0, frontend 3.11.0*
- **Statistics: Overview (instance-wide) and Selected Server tabs.** *frontend 3.10.0*
- **Virtual Servers: Select/Deselect toggle** on each card. *frontend 3.9.0*
- **Miscellaneous page** — Global message, rename the manager's own query nickname, snapshots (create, download, restore), and reset permissions. *backend 2.15.0, frontend 3.8.0*
- **Collapsible sidebar sections** — One by one. *frontend 3.7.0*
- **Virtual Servers: Server Counter and Create Server**, plus a new Statistics page. *frontend 3.6.0*
- **Accent colours** — Under Settings → WebGui, with an installation default and a personal override.
- **Private Channel Creator bot flow template** — Replaces Temp Channel Creator (inspired by SinusBot's Private Channel Manager by Smorrebrod / Cedrik Paetz). Gives each client a persistent own channel, with optional password, lifetime, placement and spam protection. Adds conditional template fields, a Variable "Get", `count()`, error outputs on actions, and treats WebQuery error 1281 as an empty result.
- **Bot Flow editor: expand button** — Opens Message and Channel Description fields in a large editor.
- **Welcome Message template rebuilt** — Multi-line message, excluded groups, a team-online count, an online count that no longer includes query clients, and `!wmp ignore`/`unignore`. Adds the "Count Online in Groups" and "List Add/Remove" actions and the `hasGroup()` condition.
- **ServerQuery Debug toggle** (Settings → Debug) — Logs every WebQuery and SSH command with its response.
- **Bot Identity** — An optional separate ServerQuery login per server, so bot-flow actions appear under their own name instead of "serveradmin". Created with scope `manage`; a "Fix Permissions" button reissues older keys.
- **Optional two-factor authentication (TOTP)** — With recovery codes and "remember this device for 15 days".
- **Settings → Users: Sessions** — Lists a user's logins, with revoke one or all.
- **Settings → Users: Last Login column, search, and renaming users.**
- **Update check** — A banner shows when backend, sidecar or frontend is behind `main`, with the command to copy. It is notify-only, never auto-update, rechecks at every login, and Recheck Now gives feedback. All components restarted at an independent **2.0.0**. — [clusterzx/ts6-manager#35](https://github.com/clusterzx/ts6-manager/issues/35)
- **Single Sign-On via OpenID Connect** (Authentik, Keycloak, Authelia, Zitadel, …) — Under Settings → SSO. New users start as viewers and are matched by the `sub` claim, never by email. A user without server access sees "No access to this server" instead of a misleading connection error. — [clusterzx/ts6-manager#71](https://github.com/clusterzx/ts6-manager/issues/71)
- **Roles Bot Operator and Music Operator** — Update Status is admin-only.
- **"Keep played songs" toggle** (Settings → YouTube) — Auto-deletes chat-command downloads about an hour after playing.
- **Settings → Users: Server Access** — Choose which connections a viewer sees.
- **Bot Flow Loop node** — It changes what WebQuery "Store As" stores, see the upgrade notes. — [clusterzx/ts6-manager#48](https://github.com/clusterzx/ts6-manager/issues/48)
- **Music bot avatar and description template** — With placeholders such as `{title}` and `{remaining}`, applied live. The avatar is affected by a TS6 server bug, see [Known Issues](README.md#known-issues-upstream-ts6-server-bug).
- **Spotify track links in `!play`, `!queue` and `!stream`** — Resolved to artist and title and searched on YouTube. — [clusterzx/ts6-manager#44](https://github.com/clusterzx/ts6-manager/issues/44)
- **Permissions: "Show offline clients"** and search in the client picker. — [clusterzx/ts6-manager#31](https://github.com/clusterzx/ts6-manager/issues/31)
- **Settings → Restart** — Scheduled restarts of the backend and/or sidecar container. — [clusterzx/ts6-manager#55](https://github.com/clusterzx/ts6-manager/issues/55)
- **Settings → Debug "Danger Zone"** — Resets radio station or music bot IDs back to 1. Radio stations show their ID. — [clusterzx/ts6-manager#58](https://github.com/clusterzx/ts6-manager/issues/58)
- **Library "Scan for New Files"** (also at startup) — Picks up files already in the music folder and looks up real titles for files named by YouTube ID. — [clusterzx/ts6-manager#79](https://github.com/clusterzx/ts6-manager/issues/79)
- **Video Stream tab picks videos already on disk** — The Library accepts video uploads with an All/Audio/Video filter. — [clusterzx/ts6-manager#33](https://github.com/clusterzx/ts6-manager/issues/33)
- **Search terms in `!play`, `!queue` and `!stream`** — Instead of only URLs.
- **Permissions: "Only show set" toggle.** — [clusterzx/ts6-manager#38](https://github.com/clusterzx/ts6-manager/issues/38)
- **Command trigger arguments one by one** — `command_args_list`, `command_args_length`. — [clusterzx/ts6-manager#46](https://github.com/clusterzx/ts6-manager/issues/46)
- **AFK Mover: "Exempt Channel IDs".** — [clusterzx/ts6-manager#63](https://github.com/clusterzx/ts6-manager/issues/63)
- **Music bot IDs on the overview cards.** — [clusterzx/ts6-manager#66](https://github.com/clusterzx/ts6-manager/pull/66) by [ValiOff8](https://github.com/ValiOff8)
- **Server Groups: add and remove members** — Directly in the UI. — [clusterzx/ts6-manager#77](https://github.com/clusterzx/ts6-manager/issues/77)

### Improvements

- **Dashboard charts always show the last 20 minutes** — The backend measures continuously from startup and keeps the samples across restarts. *backend 2.37.0, frontend 3.48.0* [#201](https://github.com/DomeNinchen/ts6forkmanager/pull/201)
- **Group import reports per group and per permission** — What failed and why, instead of one generic error, and it no longer aborts on the first failure. *frontend 3.45.1* — reported in [#186](https://github.com/DomeNinchen/ts6forkmanager/issues/186)
- **Unknown `/api` paths answer a JSON 404** — Instead of Express's default page, keeping the security headers. *backend 2.34.1*
- **Light and dark themes meet WCAG AA contrast** — Every combination, fixing dark Green and Violet. *backend 2.33.0, frontend 3.43.0*
- **Readable flow editor connections** — No longer cut off beyond x = 2000, run horizontally and vertically around nodes, and backward connections pass below. Bend points can be added, moved and removed by hand and are saved with the flow; a usage dialog explains the controls. *frontend 3.36.1–3.40.1*
- **README screenshots replaced** — With the current interface, including new ones for video streaming and permissions comparison.
- **Unused `@xyflow/react` dependency removed.** *frontend 3.36.2*
- **Documentation moved into the [wiki](https://github.com/DomeNinchen/ts6forkmanager/wiki)** — The README is shortened and reordered, with requirements before the quick start. *frontend 3.33.2*
- **"Command Deck" look on every page** — The redesign began with a navy base theme, new fonts and a rebuilt Dashboard. *frontend 3.0.0 up to 3.5.0*
- **Dashboard ping measures real reachability** — With a history sparkline, and an optional "Dashboard Ping Target" per connection.
- **The project's own logo** — Replaces the "TS" badge.
- **The sidebar logo links to the Dashboard.**
- **YouTube cookies are actually tested** — Against YouTube, with a Recheck button and an app-wide banner when they stop working.
- **Music bots identify as a real, signed TeamSpeak client version** (`5.0.0-beta.25`).
- **Editing SSH settings reconnects the SSH listener immediately.** — [clusterzx/ts6-manager#78](https://github.com/clusterzx/ts6-manager/issues/78)
- **Edit Connection no longer requires re-entering the API key** to save.
- **yt-dlp updates itself at every backend start.** — [clusterzx/ts6-manager#82](https://github.com/clusterzx/ts6-manager/issues/82)
- **Clearing the music queue** — Already covered by the Queue tab (no change needed). — [clusterzx/ts6-manager#57](https://github.com/clusterzx/ts6-manager/issues/57)

### Security

- **`mysql2` pinned to a patched release** — Via `pnpm.overrides`, for two Dependabot alerts (pulled in by the Prisma CLI, never used here). *backend 2.40.2* [#220](https://github.com/DomeNinchen/ts6forkmanager/pull/220)
- **`expr-eval` replaced by the maintained `expr-eval-fork`** — For three Dependabot alerts; bot-flow conditions evaluate exactly as before. *backend 2.40.1* [#219](https://github.com/DomeNinchen/ts6forkmanager/pull/219)
- **Security headers on the frontend** — Content-Security-Policy, X-Frame-Options, HSTS, nosniff, Permissions-Policy, CORP, COOP, COEP, with `/widget/` kept embeddable. *frontend 3.44.1–3.44.3*
- **Admins cannot lock the instance out** — They cannot remove their own admin role, disable or delete themselves, or remove the last active admin (enforced by the API).

### Bug Fixes

- Fixed the Bots tab's queue preview listing finished tracks. *frontend 3.49.1* [#206](https://github.com/DomeNinchen/ts6forkmanager/pull/206)
- Fixed playing a track from the web interface stranding the rest of the queue; it is now inserted after the current track. *backend 2.37.1* [#205](https://github.com/DomeNinchen/ts6forkmanager/pull/205)
- Fixed saving Edit Channel without a rename failing with error 771. *frontend 3.41.0*
- Fixed a black, silent picture for viewers after switching a stream's source; the sidecar keeps RTP numbering continuous. *sidecar 2.0.1*
- Fixed a TS6 server crash triggered by abrupt SSH disconnects: SSH ServerQuery connections say `quit` on shutdown ([teamspeak/teamspeak6-server#124](https://github.com/teamspeak/teamspeak6-server/issues/124)). *backend 2.23.0*
- Fixed saving a connection wiping its SSH username; SSH fields show "(unchanged)". *backend 2.22.0, frontend 3.17.0*
- Fixed the backend starting on an unmigrated database when `prisma db push` fails. *backend 2.20.0*
- Fixed Query and Bot Identity nicknames getting lost on backend restarts and reconnects. *backend 2.17.0–2.18.0, frontend 3.13.0–3.14.0*
- Fixed bot flow "Send Message" to a channel failing with `already member of channel` (error 770).
- Fixed four Template Gallery templates: blank values after the `.0.` change, Anti-VPN never triggering, and the Assign Group log line.
- Fixed the Bot Flow "Set Variable" node: editor and engine used different keys. Old flows work without re-saving.
- Fixed `!stop` claiming to stop playback when nothing was playing.
- Fixed a crash on two simultaneous token refreshes. — [clusterzx/ts6-manager#50](https://github.com/clusterzx/ts6-manager/issues/50)
- Fixed a music bot crash on an unknown TeamSpeak escape sequence. — [clusterzx/ts6-manager#54](https://github.com/clusterzx/ts6-manager/issues/54)
- Fixed "Test Connection" not showing the real result and failure reason. — [clusterzx/ts6-manager#37](https://github.com/clusterzx/ts6-manager/issues/37)
- Fixed music commands when TeamSpeak wraps links in `[URL]` BBCode. — [clusterzx/ts6-manager#39](https://github.com/clusterzx/ts6-manager/pull/39) by [s3bul](https://github.com/s3bul)

### Upgrade Notes

**Bot flows**

- **Breaking:** WebQuery "Store As" now stores the full result list, so single-row reads need `.0.` (`{{temp.name.0.field}}`). — [clusterzx/ts6-manager#48](https://github.com/clusterzx/ts6-manager/issues/48)
- Older Bot Identity keys can be reissued with the "Fix Permissions" button.

**Music bots**

- Chat command permissions: `!play`, `!stream` and `!np` are open by default; every other music command is closed until a server group is assigned on the Music Bots Permissions tab. [#184](https://github.com/DomeNinchen/ts6forkmanager/issues/184)

### Updating

For installations built from the Git repository (the command at the time; since October it is `git pull --autostash && docker compose up -d --build`):

```bash
git pull && docker compose up -d --build
```

## Initial fork work

The changes that made this fork worth starting, before the per-change history above.

- **Video streaming stutter fixed** — three causes: a missing shared volume between backend and sidecar, a single bad RTP timestamp poisoning the A/V-sync estimate, and VP8 encoding that ran effectively single-threaded.
- **Videos are pre-downloaded and streamed from disk** instead of from a rate-limited live CDN URL, for real HD quality. Ported from [uniskela/ts6-manager](https://github.com/uniskela/ts6-manager), itself adapted from [uniplayer1/ts6-manager](https://github.com/uniplayer1/ts6-manager).
- **Multi-threaded VP8 encoding** tuned for quality per bit, and A/V sync pacing clamped against bad timestamps.
- **Streams stop when a clip ends** instead of looping, and the in-browser preview has a mute toggle.
- **Security pass after a Trivy scan** ([clusterzx/ts6-manager#80](https://github.com/clusterzx/ts6-manager/issues/80)): fixed a Go WebRTC dependency chain with 8 critical advisories, multer DoS CVEs and more. Dependabot, an on-demand Trivy workflow and branch protection enabled.
- **Bot-flow condition injection fixed**: a crafted chat message could alter what a condition checked.
- **Container restarts shut down cleanly.** Node now receives `SIGTERM`, the SSH query client waits for its connection to close, and an in-flight reconnect no longer races the shutdown — previously old sessions stayed registered on the TeamSpeak server.
- **Dependencies brought up to date:** Node 24, Express 5, Prisma 7, React 19, Vite 8, Tailwind 4, `react-router` 8, TypeScript 7, `@tanstack/react-table` 9. Unused `zod`, `react-hook-form` and `@hookform/resolvers` removed.
