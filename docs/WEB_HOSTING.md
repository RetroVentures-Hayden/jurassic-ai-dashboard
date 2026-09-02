# Hosting the dashboard as a web app

The desktop app is Electron. `src/server/` adds a **web host** that serves the
same UI (`src/renderer/`) over HTTP, so you can open the dashboard in a phone
browser. Run it on the Pop!\_OS laptop, expose it through the existing Cloudflare
Tunnel, and add it to your iPhone home screen.

```
iPhone Safari ──HTTPS──> Cloudflare ──tunnel──> cloudflared ──> node src/server (127.0.0.1:4178) ──> jurassic.duckdb
```

## What the web build has

Checklist, Wiki/Maps, Books, Animals, News, Chat, Settings — the full set.

- Toggles persist; Amazon / wiki / Wikipedia links open in a new tab.
- Map & book preview images stream from the server's cache (`/local-file`).
- **Animals → Sync Now** works; the nightly sync also runs **inside the web
  host** on a 30-minute timer (`src/server/scheduler.js`). While the web host is
  up you do not need `jurassic-animal-sync.timer` — and it would fail anyway,
  since DuckDB allows a single writer and the web host holds it.
- **Chat** works only if Ollama is running on the laptop (`ollama serve`).

There is **no Library / media tab** — the local-movie feature was removed from
both the desktop and web builds.

> **Run the web host OR the Electron app, not both.** They both open
> `jurassic.duckdb` read-write; the second to start will fail.

## 1. Run it locally first

```bash
cd "/home/haydenross/Personal/Hobby/Folders/VS Code/Projects/Jurassic AI Dashboard"
WEB_TOKEN="pick-a-long-random-string" npm run web
```

Open `http://127.0.0.1:4178/?dt=pick-a-long-random-string`. The token then lives
in a year-long cookie.

| Var | Default | Purpose |
| --- | --- | --- |
| `WEB_PORT` | `4178` | Listen port |
| `WEB_HOST` | `127.0.0.1` | Bind address — keep it loopback; cloudflared reaches it locally |
| `WEB_TOKEN` | *(none)* | Shared secret. If unset the server is **open** — set it, or put Cloudflare Access in front. |

## 2. Keep it running: systemd --user unit

`~/.config/systemd/user/jurassic-web.service`:

```ini
[Unit]
Description=Jurassic AI Dashboard web host
After=network-online.target

[Service]
Type=simple
WorkingDirectory=/home/haydenross/Personal/Hobby/Folders/VS Code/Projects/Jurassic AI Dashboard
ExecStart=/home/haydenross/Personal/Hobby/Folders/.nvm/versions/node/v22.22.2/bin/node src/server/server.js
Environment=WEB_PORT=4178
Environment=WEB_HOST=127.0.0.1
Environment=WEB_TOKEN=CHANGE-ME
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

```bash
systemctl --user daemon-reload
systemctl --user enable --now jurassic-web.service
systemctl --user disable --now jurassic-animal-sync.timer   # the web host does this now
loginctl enable-linger "$USER"                              # keep it up when logged out
journalctl --user -u jurassic-web -f
```

## 3. Add it to the existing Cloudflare Tunnel (`haydenservers.us`)

The `jellyfin` tunnel (`b24a969b-b4c2-4177-902a-03cf4ebf6060`) already routes
`jellyfin.` and `photos.haydenservers.us`. Add `jurassic.` to it.

**a. DNS route** (run as your user — uses `~/.cloudflared/cert.pem`):

```bash
cloudflared tunnel route dns b24a969b-b4c2-4177-902a-03cf4ebf6060 jurassic.haydenservers.us
```

**b. Ingress** — the live config the service runs is `/etc/cloudflared/config.yml`
(and you keep `~/.cloudflared/config.yml` as a mirror). Add the `jurassic` block
**above** the `http_status:404` catch-all in both:

```yaml
ingress:
  - hostname: jellyfin.haydenservers.us
    service: http://localhost:8096
  - hostname: photos.haydenservers.us
    service: http://localhost:2283
  - hostname: jurassic.haydenservers.us
    service: http://localhost:4178
  - service: http_status:404
```

**c. Restart the tunnel:**

```bash
sudo systemctl restart cloudflared
```

Then open `https://jurassic.haydenservers.us/?dt=YOUR_TOKEN` once on the iPhone
and **Share → Add to Home Screen**.

### Lock it down (recommended)

`WEB_TOKEN` is a thin guard. Add **Cloudflare Zero Trust → Access → Application**
on `jurassic.haydenservers.us` allowing only your email (one-time PIN), the same
way you'd protect any self-hosted app. With Access in front you can drop
`WEB_TOKEN`.

## Offline note

A Cloudflare Tunnel needs internet on both ends — it's "reach my laptop from
anywhere", not "works on a plane".
