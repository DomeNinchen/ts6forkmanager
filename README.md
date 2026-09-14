#### DISCLAIMER: 
![AI Assisted](https://img.shields.io/badge/AI%20Assisted-Project-00ADD8?style=for-the-badge&logo=dependabot&logoColor=white)
This is a fork of clusterzx/ts6-manager

# TS6 Manager

Web-based management interface for TeamSpeak servers. Control virtual servers, channels, clients, permissions, music bots, automated workflows, and embeddable server widgets — all from your browser.

Built on the **WebQuery HTTP API** (the ServerQuery replacement in modern TeamSpeak builds). Telnet is not used or supported.

![License](https://img.shields.io/badge/license-MIT-blue)

## Why This Fork Exists

Upstream had a persistent video/audio streaming stutter that was never resolved, plus a pile of security findings nobody had triaged. This fork root-caused and fixed the streaming stutter, did a full security-hardening pass, and has since grown a considerable number of its own features and upstream-requested fixes on top.

**See [CHANGELOG.md](CHANGELOG.md)** for the full history — a short summary of the headline changes, followed by every individual change in the order it shipped.

## Screenshots

### Dashboard
Live overview of your server: online users, channel count, uptime, ping, bandwidth graph, and server capacity at a glance.

![Dashboard](docs/dashboard.png)

### Music Bots
Run multiple music bots per server. Each bot has its own queue, volume control, and playback state. Supports radio streams, YouTube, and a local music library. Users in the bot's channel can control it via text commands (`!radio`, `!play`, `!vol`, etc.).

![Music Bots](docs/musicbots.png)

### Bot Flow Engine
Visual node-based editor for building automated server workflows. Drag triggers, conditions, and actions onto the canvas, connect them, and deploy. Supports TS3 events, cron schedules, webhooks, and chat commands as triggers.

![Flow Editor](docs/flow-editor.png)

### Flow Templates
Get started quickly with pre-built flow templates. Covers common use cases like temporary channel creation, AFK movers, idle kickers, online counters, and group protection. One click to import, then customize to your needs.

![Flow Templates](docs/flow-templates.png)

## Features

### Server Management
- Dashboard with live server stats, capacity overview, and a bandwidth graph showing the last ~15 minutes immediately on load (sampled continuously in the background, not just from when the page happens to be open)
- Virtual server list with start/stop controls
- Channel tree with drag-and-drop ordering, including ServerQuery/bot clients (visually distinguished from regular users)
- Client list with kick, ban, move, poke actions
- Server & channel group management, including adding/removing members via a searchable client picker
- Permission editor (server, channel, client, group-level), including offline clients (searchable, not just who's currently connected)
- Ban list management
- Token / privilege key management
- Complaint viewer
- Offline message system
- Server log viewer with filtering
- Channel file browser with upload/download
- Instance-level settings

### Music Bots
- Multiple bots per server, each with independent queue and playback
- Radio station streaming with ICY metadata and live title updates
- YouTube playback via yt-dlp (search, download, queue)
- Media library management: upload audio or video, or scan for files already sitting in the shared music folder (e.g. a volume shared with another app), organized into `music/`/`video/` subfolders, filterable by type and sortable by title/type/duration; playlists
- Queue tab: clear, reorder, remove individual items, click-to-play
- Volume control, pause, skip, previous, shuffle, repeat
- Stereo audio support with stable 20ms pacing
- Auto-reconnect with exponential backoff on disconnect
- In-channel text commands for hands-free control
- Music request history tracking
- Custom avatar (PNG/JPEG/GIF/WebP; size limit is whatever your TS server's own `i_client_max_avatar_filesize` permission allows) and a templated `client_description`, set from the Create/Edit Music Bot dialog and applied live. The description updates whenever something actually changes (song start/change, queue size, editing the template) - plus every ~30s while playing, but only if the template contains a time placeholder like `{remaining}`, so it isn't polled needlessly otherwise. Shows a "-"/"0" idle form when nothing is playing instead of going blank. **⚠️ The avatar is currently broken by a TS6 server bug, not this fork's code — see [Known Issues](#known-issues-upstream-ts6-server-bug)**. The description template works correctly. Supports:
  - `{title}` — title of the currently playing track
  - `{artist}` — artist, if known (empty string otherwise)
  - `{remaining}` — time left in the current track, auto-formatted (`"42 min"`, or `"1h 5min"` past 60 minutes); empty for live streams
  - `{remaining_min}` — time left across the whole queue (this track plus everything still queued after it) as a plain minute count, e.g. `"10 min"` (no hour rollover, unlike `{remaining}`); empty while the current track's own duration is unknown (e.g. a live stream)
  - `{elapsed}` — time played so far, formatted the same way as `{remaining}`
  - `{duration}` — total track length, formatted the same way; empty for live streams
  - `{queue_length}` — number of songs still queued after this one

### Video Streaming
- Video streaming from YouTube, Twitch, direct URLs, or an uploaded video already in the library to TeamSpeak channels
- YouTube/Twitch sources are downloaded once (real `bestvideo+bestaudio` merge via yt-dlp) before playback starts, then streamed from disk — this avoids feeding ffmpeg a live, rate-limited CDN URL and gives noticeably better quality than a single pre-muxed format
- WebRTC-based with Go sidecar relay (Pion) for low-latency delivery
- Quality presets (480p, 720p, 1080p)
- In-browser preview with WebRTC playback (with a mute/unmute toggle)
- Live viewer list with per-viewer kick, both in the WebUI and via `!viewers` in chat
- Adaptive A/V pacing based on RTP timestamps vs. wall clock, with a clamp to prevent a single bad timestamp from stalling playback
- Multi-threaded VP8 encoding, scaled to the host's available cores
- Runs as a Docker sidecar container alongside the backend

### Bot Flow Engine
- Visual flow editor with drag-and-drop node canvas
- Triggers: TS3 events, cron schedules, webhooks (with mandatory secrets), chat commands (global or channel-specific)
- Actions: kick, ban, move, message, poke, channel create/edit/delete, HTTP requests, WebQuery commands
- Conditions, variables, delays, logging
- Loop node: iterates a list stored in a temp variable (e.g. a WebQuery's "Store As" result), running its "Body" output once per item (`{{temp.item}}` for the current item, `{{temp.item_index}}` for its position) and its "After" output once when done. Default cap 50 items, hard ceiling 500
- Animated channel names (rotating text on a timer)
- Placeholder system with filters and expressions
- Pre-built templates for common automation tasks

### Server Widgets
- Embeddable server status banner for websites and forums
- Token-based public access (no authentication required)
- Available as live page, SVG, or PNG image
- Dark and light themes
- Configurable: show/hide channel tree and client list

### Security
- Setup wizard for initial admin account (no default credentials)
- AES-256-GCM encryption for stored credentials (API keys, SSH passwords)
- SSRF protection on all outbound HTTP requests and FFmpeg URLs
- Rate limiting on authentication endpoints
- JWT access + refresh token rotation with reuse detection
- Role-based access control (admin / viewer)
- Per-server access control for multi-tenant setups, manageable per user from Settings → Users
- Single Sign-On via any standard OpenID Connect provider (Authentik, Keycloak, Authelia, Zitadel, ...), alongside local login — see Settings → SSO
- WebQuery command whitelist in bot flows (blocks destructive commands)
- Authenticated WebSocket connections
- Password complexity requirements

### Settings & Administration
- yt-dlp cookie file management for accessing age-restricted or member-only YouTube content
- Upload cookies via file or paste directly in the UI
- Cookies are actually validated against YouTube (not just checked for a file's presence) — on upload, on a 6h schedule, and on demand via a "Recheck" button; a dismissible banner appears app-wide when they stop working (cookies rotate over time, so a once-working file can quietly go stale)
- Admin-only settings panel
- Debug logging toggles (voice bot, Rank Check) switchable at runtime from Settings → Debug — no env var or restart needed
- "Danger Zone" (Settings → Debug) to reset the radio station / music bot id counters, for when SQLite's ever-climbing autoincrement gets annoying after deleting everything and starting over
- Scheduled restart (Settings → Restart) for ts6-manager's own backend and/or sidecar container, on a configurable time and day-of-week — not the TeamSpeak server itself
- Settings → Update Status: current vs. latest version for backend, sidecar, and frontend, when they were last checked, and a "Recheck Now" button — the same data the update banner uses, viewable any time even when nothing is outdated. Also rechecked automatically on every login (local or SSO), not just every 6h in the background, so what you see right after logging in reflects a fresh check rather than whatever the background timer happened to have cached
- Settings → YouTube → "Keep played songs" toggle: controls whether songs downloaded via chat commands (`!play`/`!queue`/`!stream`) are kept in the music library indefinitely (default) or automatically deleted about an hour after playing to save disk space. Only affects these ad-hoc chat downloads — songs added deliberately via the Library tab are always kept

## Known Issues (Upstream TS6 Server Bug)

- **Music bot avatar only visible to TS6 clients, not TS3** ([teamspeak/teamspeak6-server#122](https://github.com/teamspeak/teamspeak6-server/issues/122)): an avatar uploaded while connected shows correctly to other TS6 clients, but a TS3 client viewing the same connection gets stuck on "Loading Image" forever. Confirmed this is server-side, not about which client (or bot) does the uploading, with a real, isolated test against a real TS6 server — including a control test using the *official TS6 client itself* (not just this fork's code): the *same* official TS6 client produces a TS3-compatible avatar when connected to an (old) TS3 server, but not when connected to a TS6 server. Matches TeamSpeak's own previously-reported [avatar "convert error"](https://community.teamspeak.com/t/avatar-cannot-be-set-convert-error/60941) thread. Can't be fixed from this fork's side; needs a TeamSpeak server fix.

The music bot description template was affected by a similar-looking issue (`clientupdate client_description=...` rejected outright) — turned out to be this fork using the wrong ServerQuery command rather than a TS6 bug: `client_description` is only documented as a `clientedit` (ServerQuery, edit-from-outside) parameter, not a `clientupdate` (self, over the bot's own voice connection) one. Fixed by pushing the description via `clientedit` over the existing WebQuery connection instead.

## Architecture

```
┌──────────────┐     ┌──────────────┐     ┌─────────────────┐
│   Frontend   │────▶│   Backend    │────▶│  TS Server      │
│  React SPA   │     │  Express API │     │  WebQuery HTTP  │
│  nginx :80   │     │  Node :3001  │     │  SSH (events)   │
└──────────────┘     └──────┬───────┘     └─────────────────┘
                            │
                     ┌──────┴───────┐
                     │   SQLite     │
                     │   (Prisma)   │
                     └──────────────┘
                            │
                     ┌──────┴───────┐
                     │   Sidecar    │
                     │  Go/Pion     │
                     │  WebRTC :9800│
                     └──────────────┘

Public:  /widget/:token  ──▶  SVG / PNG / JSON (no auth)
```

**Four packages** in a pnpm monorepo:

| Package | Description |
|---------|-------------|
| `@ts6/common` | Shared types, constants, utilities |
| `@ts6/backend` | Express API, WebQuery client, bot engine, voice bots, widgets |
| `@ts6/frontend` | React SPA with Vite, TailwindCSS, shadcn/ui |
| `sidecar` | Go WebRTC media relay (Pion) for video streaming |

The backend proxies all TeamSpeak API calls. The frontend never has direct access to API keys or server credentials.

## Tech Stack

**Frontend:** React 19, Vite, TailwindCSS, shadcn/ui, TanStack Query + Table, React Flow, Recharts, Zustand

**Backend:** Node.js, Express, Prisma (SQLite), JWT authentication, WebQuery HTTP client, SSH event listener

**Voice/Audio:** Custom TS3 voice protocol client (UDP), Opus encoding, FFmpeg, yt-dlp

**Video Streaming:** Go sidecar with Pion WebRTC v4, RTCP Sender Reports for A/V sync

## Quick Start (Docker)

1. Download the [`docker-compose.yml`](docker-compose.yml)
2. Create a `.env` file next to it:

```env
JWT_SECRET=your-random-secret-at-least-32-characters
ENCRYPTION_KEY=another-random-secret-for-credential-encryption
```

Generate secure values:

```bash
echo "JWT_SECRET=$(openssl rand -base64 32)" >> .env
echo "ENCRYPTION_KEY=$(openssl rand -base64 32)" >> .env
```

3. Start the stack:

```bash
docker compose up -d
```

4. Open `http://localhost:3000/setup` and create your admin account
5. Log in, then add your TeamSpeak server connection under **Settings → Connections** (host, WebQuery port, API key)

> `JWT_SECRET` is **required** — the backend will refuse to start in production without it.
> `ENCRYPTION_KEY` is optional but recommended — if not set, `JWT_SECRET` is used as fallback for credential encryption.

### Coolify / Reverse Proxy

Use [`docker-compose.coolify.yml`](docker-compose.coolify.yml) as a starting point. Key differences from the standard compose:

- No `ports` section on backend/frontend — the reverse proxy handles routing
- The sidecar's WebRTC media ports (`50000-50100/udp`) stay published directly regardless — that's UDP traffic and can't go through an HTTP reverse proxy, so it needs its own firewall rule on the host
- Set the domain on the **frontend** service in Coolify (port 80)
- If your TS server runs in a separate Docker network, add it as an external network on the backend service:

```yaml
services:
  backend:
    networks:
      - ts6-network
      - ts-server-net

networks:
  ts-server-net:
    external: true
    name: your-ts-server-network-id
```

## Development

Requires: Node.js 24+, pnpm 9+

```bash
pnpm install
pnpm dev          # starts backend + frontend in parallel
```

Backend runs on `:3001`, frontend on `:5173` (Vite dev server).

### Database

Prisma with SQLite. On first run:

```bash
cd packages/backend
npx prisma db push
```

The Docker images run this automatically on startup.

## Environment Variables

<details>
<summary>Click to expand (15 variables — <code>JWT_SECRET</code> is the only one you actually need to set)</summary>

| Variable | Default | Description |
|----------|---------|-------------|
| `JWT_SECRET` | — | **Required.** Secret for JWT signing. Must be set in production. |
| `ENCRYPTION_KEY` | — | Optional. Dedicated key for AES-256-GCM credential encryption. Falls back to `JWT_SECRET` if not set. |
| `PORT` | `3001` | Backend port |
| `DATABASE_URL` | `file:./data/ts6webui.db` | SQLite database path |
| `JWT_ACCESS_EXPIRY` | `15m` | Access token lifetime |
| `JWT_REFRESH_EXPIRY` | `7d` | Refresh token lifetime |
| `FRONTEND_URL` | `http://localhost:3000` | CORS origin |
| `MUSIC_DIR` | `/data/music` | Root for the media library. New uploads/downloads are organized into `music/`/`video/` subfolders underneath it; files sitting directly in the root (from before that split, or a volume shared with another app) are still picked up by scan and the stream-source picker |
| `SIDECAR_URL` | — | Optional. Full URL of the WebRTC sidecar service (e.g. `http://ts6-sidecar:9800`). Set in Docker when sidecar runs as a separate container. |
| `SIDECAR_BINARY_PATH` | `sidecar` | Path to the sidecar binary/command, used only in local mode (running the sidecar as a subprocess instead of a separate container). |
| `YT_COOKIE_FILE` | — | Optional. Path to a Netscape-format cookies.txt file for yt-dlp. Can also be managed via **Settings → YouTube** in the UI. |
| `TS_ALLOW_SELF_SIGNED` | `false` | Set to `true`/`1` to accept self-signed TLS certs when connecting to the TeamSpeak WebQuery API. |
| `VOICE_DEBUG` | unset (off) | Legacy. Set to `1` to enable verbose voice-bot/audio-pipeline debug logging. Only read once, on first boot, to seed the DB-backed setting if it has never been saved — once saved, **Settings → Debug** in the UI is authoritative and this variable is ignored. |
| `RANK_CHECK_DEBUG` | unset (off) | Legacy. Same as above but for per-client Rank Check detail (computed hours, group membership). Promotions, errors, and the per-run summary always log regardless of this flag. Prefer **Settings → Debug** — toggle at runtime, no restart needed. |
| `NODE_ENV` | `development` | Set to `production` in Docker; enables the startup guard that refuses a default `JWT_SECRET`. |

</details>

## Environment Variables — Sidecar (Video Streaming)

Read directly from `packages/sidecar/main.go`; defaults below are the sidecar's own built-in fallbacks. The shipped `docker-compose.yml` overrides `VIDEO_QUEUE_SIZE`/`AUDIO_QUEUE_SIZE` to `8192`/`16384` (noted below) — sized for the vserver this fork was tuned against, not a hard requirement.

<details>
<summary>Click to expand (18 variables — tuning knobs, none required for a default setup)</summary>

| Variable | Default | Description |
|----------|---------|-------------|
| `SIDECAR_PORT` | `9800` | HTTP API port |
| `FFMPEG_PATH` | `ffmpeg` | Path to the ffmpeg binary |
| `SIDECAR_DEBUG_LOGS` | unset (off) | Set to `1` to enable verbose per-packet debug logging |
| `STUN_SERVERS` | built-in public STUN list | Comma-separated STUN server URLs to override the default list |
| `ICE_UDP_PORT_MIN` / `ICE_UDP_PORT_MAX` | `50000` / `50100` | Fixed UDP port range for WebRTC ICE candidates, so it can be firewalled explicitly. Must match the published Docker port range. |
| `VIDEO_QUEUE_SIZE` | `1024` (compose: `8192`) | Size of the video RTP queue between the UDP reader and the pacing/forwarder goroutine |
| `AUDIO_QUEUE_SIZE` | `2048` (compose: `16384`) | Size of the audio RTP queue |
| `VIDEO_RTP_READ_BUFFER` | `4194304` (4 MiB) | OS-level UDP socket read buffer for the video port |
| `AUDIO_RTP_READ_BUFFER` | `1048576` (1 MiB) | OS-level UDP socket read buffer for the audio port |
| `SYNC_PLAYOUT_BUFFER_MS` | `50` | Baseline playout buffer added on top of measured latency in the A/V sync pacing logic |
| `SYNC_VIDEO_BIAS_MS` | `0` | Optional extra holdback applied to video only, to fine-tune A/V sync |
| `SYNC_MAX_DELAY_MS` | `500` | Upper bound on the computed pacing delay — clamps a single bad RTP timestamp (source discontinuity) from stalling playback and overflowing the RTP queues |
| `VIDEO_WIDTH` / `VIDEO_HEIGHT` / `VIDEO_FRAMERATE` | `1280` / `720` / `30` | Fallback video dimensions/framerate when the caller doesn't specify a preset (e.g. the idle black-screen source) |
| `VIDEO_BITRATE` | `1500k` | Fallback video bitrate when none is passed by the app |
| `AUDIO_BITRATE` | `128k` | Audio encode bitrate |
| `AUDIO_DELAY_MS` | `0` | Manual audio delay (`adelay` filter); expected to stay `0` under the current pacing logic |
| `VIDEO_CPU_USED` | `4` | libvpx `-cpu-used` — a speed/quality tradeoff (0 = slowest/best quality, 8 = fastest/worst), **not** a core count |
| `VIDEO_ENCODE_THREADS` | number of host CPU cores | `-threads` passed to libvpx; unlike most ffmpeg encoders, libvpx doesn't auto-scale across cores |
| `VIDEO_BUFSIZE` | `2x` the target bitrate | ffmpeg `-bufsize` rate-control buffer. Auto-scales with bitrate so high-bitrate streams aren't rate-limited by too small a buffer; set explicitly to override |

</details>

## Music Bot Text Commands

When a music bot is connected to a channel, users in that channel can control it via chat:

| Command | Description |
|---------|-------------|
| `!radio` | List available radio stations |
| `!radio <id>` | Play a radio station |
| `!play <url, search terms, or Spotify track link>` | Play immediately (search terms resolved via YouTube search, Spotify links via their public page — see [CHANGELOG.md](CHANGELOG.md)) |
| `!play` | Resume paused playback |
| `!queue <url, search terms, or Spotify track link>` (alias `!add`) | Add to the queue without interrupting what's currently playing |
| `!stop` | Stop playback ("Nothing was playing." if there wasn't any) |
| `!pause` | Toggle pause/resume |
| `!skip` / `!next` | Next track in queue |
| `!prev` | Previous track |
| `!vol` | Show current volume |
| `!vol <0-100>` | Set volume |
| `!np` | Show current track |
| `!stream <url, search terms, or Spotify link> [preset]` | Start (or switch) a video stream; optional trailing `480p`/`720p`/`1080p` |
| `!stopstream` | Stop the active video stream (independent of audio playback) |
| `!viewers` | List clients currently watching the video stream |

## Requirements

- TeamSpeak server with **WebQuery HTTP** enabled (not raw/telnet)
- WebQuery API key (generated via `apikeyadd` or server admin tools)
- SSH access to the TS server (only needed for bot flow event triggers)
- `yt-dlp` and `ffmpeg` installed on the backend (included in the Docker image)



## License

MIT
