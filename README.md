<img src="docs/logo.png" alt="TS6 Manager" width="160">

# TS6 Manager

Web-based management interface for TeamSpeak servers. Control virtual servers, channels, clients, permissions, music bots, automated workflows, and embeddable server widgets — all from your browser.

Built on the **WebQuery HTTP API** (the ServerQuery replacement in modern TeamSpeak builds). Telnet is not used or supported.

![License](https://img.shields.io/badge/license-GPLv3-green.svg?style=flat)
![AI Assisted](https://img.shields.io/badge/AI%20Assisted-Project-00ADD8?style=for-the-badge&logo=dependabot&logoColor=white)

> **AI-assisted project, and a fork of [clusterzx/ts6-manager](https://github.com/clusterzx/ts6-manager)** — see [Why This Fork Exists](#why-this-fork-exists).

## Screenshots

<details>
<summary><b>Dashboard, music bots, video streaming, the visual bot flow editor, ready-made flow templates, and the permission editor</b> — click to expand</summary>

### Dashboard
Live overview of a virtual server: online users, channels, uptime, ping, bandwidth and capacity. The charts show the last 20 minutes the moment the page opens, a card charts the users of the last 24 hours, and the Statistics page keeps users, bandwidth and ping for up to a month.

![Dashboard](docs/dashboard.png)

### Music Bots
Several bots per server, each with its own queue, volume and playback state: radio streams, YouTube and a local library, controlled from the web interface or by chat commands (`!radio`, `!play`, `!vol`, …). A bot's card says whether it is connecting, retrying or stopped, and the server's reason.

![Music Bots](docs/musicbots.png)

### Video Streaming
Stream YouTube, Twitch, a direct URL or a video from your library into a TeamSpeak channel over WebRTC, with a queue, a live preview in the browser and a list of who is watching.

![Video Streaming](docs/video-streaming.png)

### Bot Flow Engine
Visual node-based editor for automated server workflows: triggers (TeamSpeak events, cron schedules, webhooks, chat commands), conditions and actions, connected on a canvas.

![Flow Editor](docs/flow-editor.png)

### Flow Templates
Pre-built flows for temporary channels, AFK movers, idle kickers, online counters and group protection. One click to import, then customise.

![Flow Templates](docs/flow-templates.png)

### Permissions
Edit all five permission layers for online and offline clients alike, set many permissions at once, compare entities side by side with the differences highlighted, and see what applies to one client in one channel and where it comes from.

![Permissions](docs/permissions-compare.png)

</details>

## Why This Fork Exists

Upstream had a persistent video/audio streaming stutter that was never resolved, plus a pile of security findings nobody had triaged. This fork root-caused and fixed the streaming stutter, did a full security-hardening pass, and has since grown a considerable number of its own features and upstream-requested fixes on top.

**See [CHANGELOG.md](CHANGELOG.md)** for the full history — a short summary of the headline changes, followed by every individual change in the order it shipped.

## Requirements

**On your machine:**

- **Docker** with the Compose plugin — that's all. ffmpeg, yt-dlp and everything else the backend needs is already baked into the images

**On your TeamSpeak server** — which does not have to be the same machine:

- **WebQuery HTTP enabled** (not raw/telnet). It is off by default on TeamSpeak 6, and how you enable it depends on how your server runs: `query_protocols` has to include `http`, set either in `tsserver.yaml`, as a command-line flag, or — for the official Docker image — via `TSSERVER_QUERY_HTTP_ENABLED=1`. If you rent your server, your host may have to enable it for you
- **A WebQuery API key.** Your server prints a `serveradmin` key once, on its first-ever startup; otherwise generate one with `apikeyadd`. The key is optional: if you rent a server and your host gives out no WebQuery access, add the connection without one — the music bots (which only need the host and the voice port) work on it, and the pages that need WebQuery are hidden while that connection is selected
- **Network access to the query port** (`query_http_port`, default `10080`) from wherever this manager runs, and the server's query IP allowlist has to include the address it connects from. TeamSpeak's own documentation explicitly recommends adding a web administration interface's IP there. If the two run on separate machines that means the manager's outbound address — and you should restrict who can reach that port rather than exposing it openly. See [Getting Started](https://github.com/DomeNinchen/ts6forkmanager/wiki/Getting-Started)

**Only if you want the matching feature:**

- **SSH ServerQuery** on your TeamSpeak server — needed for bot flows triggered by server events (a client joining, leaving, moving), for the Query console's live events, and for the Files and Icons pages. Everything else, including scheduled and webhook-triggered flows, runs over WebQuery alone
- **UDP `50000-50100` open on the host** — needed exclusively for video streaming. That traffic cannot pass through an HTTP reverse proxy and needs its own firewall rule. Nothing else of the sidecar is published: its HTTP API (port `9800`) has no sign-in, so the compose file leaves it inside the Docker network, where only the backend reaches it

## Quick Start (Docker)

1. Clone the repository — the images are built from source, so the compose file alone is not enough:

```bash
git clone https://github.com/DomeNinchen/ts6forkmanager.git
cd ts6forkmanager
```

2. Create a `.env` file in the repository root:

```env
JWT_SECRET=your-random-secret-at-least-32-characters
ENCRYPTION_KEY=another-random-secret-for-credential-encryption
```

Generate secure values:

```bash
echo "JWT_SECRET=$(openssl rand -base64 32)" >> .env
echo "ENCRYPTION_KEY=$(openssl rand -base64 32)" >> .env
```

3. Create the shared Docker network — once per host. The compose file attaches to it as an *external* network, so Compose won't create it for you and the first start fails without it:

```bash
docker network create ts6-network
```

4. Build and start the stack. The first build takes a few minutes, since it compiles the Go sidecar and both Node apps:

```bash
docker compose up -d --build
```

5. Open `http://localhost:3000/setup` and create your admin account
6. Log in, then add your TeamSpeak server connection under **Settings → Connections** (host, WebQuery port, API key — the key may stay empty, see above)

> `JWT_SECRET` is **required** — the backend will refuse to start in production without it.
> `ENCRYPTION_KEY` is optional but recommended — if not set, `JWT_SECRET` is used as fallback for credential encryption.

Running it behind a reverse proxy, or on Coolify? See [Deployment](https://github.com/DomeNinchen/ts6forkmanager/wiki/Deployment). Every environment variable is listed in [Configuration](https://github.com/DomeNinchen/ts6forkmanager/wiki/Configuration).

> **Behind a reverse proxy, set `TRUST_PROXY`.** The backend learns who is connecting from the `X-Forwarded-For` header and believes it only as far as `TRUST_PROXY` says: the number of proxies in front of it (`1` by default, the frontend container's nginx alone; `2` with a host nginx or Coolify's proxy in front of that) or a list of proxy addresses. A wrong value makes the sign-in rate limit, the Connection Journal and IP bans act on your proxy instead of the visitor, or believe an address the visitor made up. **Settings → Network** shows how a request arrived and which number fits. The backend port `3001` is published on `127.0.0.1` only; open it to the network and anybody can forge that header. If you ever ban the address you come in from, `IP_BANS_DISABLED=true` is the way back in — see [Troubleshooting](https://github.com/DomeNinchen/ts6forkmanager/wiki/Troubleshooting#an-ip-ban-locked-me-out-or-does-not-catch-the-visitor).

## Documentation

**The [Wiki](https://github.com/DomeNinchen/ts6forkmanager/wiki) is the full documentation** — how to use each feature, how to configure and deploy it, and the things that are easy to get wrong. Where to start:

| | |
|---|---|
| [Getting Started](https://github.com/DomeNinchen/ts6forkmanager/wiki/Getting-Started) | Connecting your TeamSpeak server, and what WebQuery vs. SSH is actually for |
| [Users and Roles](https://github.com/DomeNinchen/ts6forkmanager/wiki/Users-and-Roles) | Roles, server access, two-factor authentication, Single Sign-On |
| [Permissions](https://github.com/DomeNinchen/ts6forkmanager/wiki/Permissions) | The five layers, which one wins, and the tools for working with them |
| [Music Bots](https://github.com/DomeNinchen/ts6forkmanager/wiki/Music-Bots) and [Bot Flows](https://github.com/DomeNinchen/ts6forkmanager/wiki/Bot-Flows) | Chat commands, video streaming, triggers, actions and templates |
| [Tips and Pitfalls](https://github.com/DomeNinchen/ts6forkmanager/wiki/Tips-and-Pitfalls) | Behaviour that looks like a bug but isn't. Worth reading early |
| [Troubleshooting](https://github.com/DomeNinchen/ts6forkmanager/wiki/Troubleshooting) | What to check when something silently isn't happening |
| [Configuration](https://github.com/DomeNinchen/ts6forkmanager/wiki/Configuration) | Every environment variable, for backend and sidecar |
| [Deployment](https://github.com/DomeNinchen/ts6forkmanager/wiki/Deployment) | Reverse proxies, Coolify, updating, backups |
| [Privacy and Hosting](https://github.com/DomeNinchen/ts6forkmanager/wiki/Privacy-and-Hosting) | What the app stores and loads, and what a host should think about (no legal advice) |
| [Development](https://github.com/DomeNinchen/ts6forkmanager/wiki/Development) | Architecture, tech stack, running it from source |

## Features

**Server management**

- **Dashboard and statistics** — live stats with a 20-minute bandwidth and ping history, and a History tab for the users, bandwidth and ping of each virtual server over a day up to a month. → [Wiki](https://github.com/DomeNinchen/ts6forkmanager/wiki/Dashboard)
- **Channels, clients and the client database** — a channel tree with drag-and-drop, the live client list with bulk kick, ban, move and describe, and a database of every profile the server has ever seen: searchable, with banning, deleting, a group mode and CSV, HTML or JSON export. → [Channels](https://github.com/DomeNinchen/ts6forkmanager/wiki/Channels), [Clients](https://github.com/DomeNinchen/ts6forkmanager/wiki/Clients), [Client Database](https://github.com/DomeNinchen/ts6forkmanager/wiki/Client-Database)
- **Files and icons** — a browser for channel file areas (upload files and whole folders, download a folder as a ZIP, preview pictures, move, delete) and the server's icon pool. → [Files](https://github.com/DomeNinchen/ts6forkmanager/wiki/Files), [Icons](https://github.com/DomeNinchen/ts6forkmanager/wiki/Icons)
- **Permissions and groups** — an editor across all five layers, offline clients included, with bulk apply, compare, find, an overview per client, and a way to add or remove permissions on every group of one type; server and channel groups with member handling and export/import between servers. → [Permissions](https://github.com/DomeNinchen/ts6forkmanager/wiki/Permissions), [Groups](https://github.com/DomeNinchen/ts6forkmanager/wiki/Server-and-Channel-Groups)
- **Moderation and access keys** — bans, complaints, offline messages, privilege keys and temporary server passwords. → [Moderation](https://github.com/DomeNinchen/ts6forkmanager/wiki/Moderation), [Tokens and Passwords](https://github.com/DomeNinchen/ts6forkmanager/wiki/Tokens-and-Passwords)
- **Virtual servers and the instance** — start, stop and create virtual servers, edit instance and per-server settings, read the server log, take snapshots. → [Virtual Servers and Instance](https://github.com/DomeNinchen/ts6forkmanager/wiki/Virtual-Servers-and-Instance), [Server Logs](https://github.com/DomeNinchen/ts6forkmanager/wiki/Server-Logs), [Server Maintenance](https://github.com/DomeNinchen/ts6forkmanager/wiki/Server-Maintenance)
- **Query console** — run any ServerQuery command over the normal WebQuery connection, with completion, a parameter help, results as tables, confirmation by name for dangerous commands and an audit trail; with SSH it also listens to live events (joins, moves, channel changes, chat, bans). → [Wiki](https://github.com/DomeNinchen/ts6forkmanager/wiki/Query-Console)
- **Connection journal** — who signed in to the web interface and who joined a TeamSpeak server, from which address and country, filterable by many fields, with a one-click ban of an address on the web interface and/or on TeamSpeak. Offline GeoIP, kept 30 days by default. → [Wiki](https://github.com/DomeNinchen/ts6forkmanager/wiki/Connection-Journal)

**Automation and media**

- **Music bots** — several bots per server with independent queues, radio, YouTube (via yt-dlp) and Spotify links, a media library with playlists, autoplay on connect, pausing when alone, and chat commands whose access can be restricted per command to server groups. → [Wiki](https://github.com/DomeNinchen/ts6forkmanager/wiki/Music-Bots)
- **Video streaming** — WebRTC streaming from YouTube, Twitch, direct URLs or your library into a channel, with a queue, quality defaults, an in-browser preview, a live viewer list and an optional end after nobody has watched for a while.
- **Bot flows** — a visual editor for automation: triggers from TeamSpeak events, cron schedules, webhooks and chat commands; actions for kick, ban, move, messages, channel management, HTTP requests and WebQuery commands; conditions, variables, loops and placeholders; ready-made templates. → [Wiki](https://github.com/DomeNinchen/ts6forkmanager/wiki/Bot-Flows)
- **Server widgets** — embeddable status banners for websites and forums, as a live page, SVG or PNG, with public token-based access. → [Wiki](https://github.com/DomeNinchen/ts6forkmanager/wiki/Widgets)

**Access, privacy and looks**

- **Security** — four roles with per-server scoping, two-factor authentication with recovery codes, Single Sign-On via any OpenID Connect provider, AES-256-GCM encryption for stored credentials, JWT with refresh-token rotation, SSRF protection and rate limiting. → [Wiki](https://github.com/DomeNinchen/ts6forkmanager/wiki/Users-and-Roles)
- **Privacy** — the interface loads nothing from a third party (its fonts are bundled), sets no HTTP cookies and keeps only what it needs in the browser; a dismissible storage notice says so and admins can switch it off. This is a description of what the software does, not legal advice. → [Wiki](https://github.com/DomeNinchen/ts6forkmanager/wiki/Privacy-and-Hosting)
- **Theming** — nine base themes (six dark, three light) combinable with ten accent colours; an installation-wide default that every user can override. → [Wiki](https://github.com/DomeNinchen/ts6forkmanager/wiki/Themes-and-Appearance)
- **Language** — English, German and French, with more added as the community translates them on [Crowdin](https://crowdin.com/project/ts6forkmanager) — no code changes needed. The choice is saved on the account; before signing in the browser's language is used.
- **Administration** — user and session management, yt-dlp cookies, runtime debug toggles, scheduled restarts and an update status page. → [Wiki](https://github.com/DomeNinchen/ts6forkmanager/wiki/Administration)

## Known Issues (Upstream TS6 Server Bug)

- **Music bot avatar only visible to TS6 clients, not TS3** ([teamspeak/teamspeak6-server#122](https://github.com/teamspeak/teamspeak6-server/issues/122)): an avatar uploaded while connected shows correctly to other TS6 clients, but a TS3 client viewing the same connection gets stuck on "Loading Image" forever. This is server-side, not about which client uploads it: the official TS6 client itself produces a TS3-compatible avatar against an (old) TS3 server, but not against a TS6 server. It matches TeamSpeak's own previously-reported [avatar "convert error"](https://community.teamspeak.com/t/avatar-cannot-be-set-convert-error/60941) thread and can't be fixed from this fork's side; it needs a TeamSpeak server fix.

## License

GPLv3
