# Hosting the dashboard as a web app (for the iPhone / other devices)

The desktop app is Electron. `src/server/` adds a **web host** that serves the
exact same UI (`src/renderer/`) over HTTP, so you can open the dashboard in a
phone browser. Run it on the Pop!\_OS laptop, expose it with a Cloudflare
Tunnel, and add it to your iPhone home screen.

```
iPhone Safari ──HTTPS──> Cloudflare ──tunnel──> cloudflared ──> node src/server (127.0.0.1:4178) ──> jurassic.duckdb + Movies & Shows/
```

## What works over the web

| Tab | Status |
| --- | --- |
| Library | Streams video in the browser with seek (HTTP range). **H.264 `.mp4` rips play on iPhone; `.mkv` / HEVC (Dominion HDCAM, Rebirth x265) will not play in Safari** — no transcoding yet. |
| Checklist / Books | Full — toggles persist, Amazon links open in a new tab. |
| Wiki/Maps | Full — wiki links open in a new tab; map/book preview images stream from the cache. |
| Animals | Full — search, filters, paging, **Sync Now**, Load Info, Wikipedia links. |
| News | Full — Refresh fetches all three topic feeds server-side. |
| Chat | Works **if Ollama is running on the laptop** (`ollama serve`). The request path is phone → Cloudflare → laptop → `localhost:11434`. |
| Settings → Choose Folder | Prompts for a path (no native folder picker in a browser). |

The nightly animal sync runs **inside the web host** on a 30-minute timer
(`src/server/scheduler.js`) — so while the web host is up you do **not** need the
`jurassic-animal-sync.timer`; in fact it would fail, because DuckDB allows a
single writer and the web host holds it.

> **Run the web host OR the Electron app, not both.** They both open
> `jurassic.duckdb` read-write and the second one will fail to start.

## 1. Run it locally first

```bash
cd "/path/to/Jurassic AI Dashboard"
WEB_TOKEN="pick-a-long-random-string" npm run web
```

Open `http://127.0.0.1:4178/?dt=pick-a-long-random-string` on the laptop. The
token is then stored in a cookie for a year. Env vars:

| Var | Default | Purpose |
| --- | --- | --- |
| `WEB_PORT` | `4178` | Listen port |
| `WEB_HOST` | `127.0.0.1` | Bind address — keep it loopback and let cloudflared reach it |
| `WEB_TOKEN` | *(none)* | Shared secret. If unset the server is **open** — always set it, or put Cloudflare Access in front (below). |

## 2. Keep it running: systemd --user unit

Create `~/.config/systemd/user/jurassic-web.service` (replace the two paths and
the token):

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
Environment=WEB_TOKEN=pick-a-long-random-string
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

```bash
systemctl --user daemon-reload
systemctl --user enable --now jurassic-web.service
systemctl --user disable --now jurassic-animal-sync.timer   # the web host does this job now
loginctl enable-linger "$USER"                               # keep it up when logged out
journalctl --user -u jurassic-web -f                         # logs
```

## 3. Expose it with a Cloudflare Tunnel

Needs a domain on Cloudflare (free plan is fine).

```bash
# install cloudflared (Cloudflare's apt repo), then:
cloudflared tunnel login
cloudflared tunnel create jurassic
cloudflared tunnel route dns jurassic jurassic.example.com
```

`~/.cloudflared/config.yml`:

```yaml
tunnel: jurassic
credentials-file: /home/haydenross/.cloudflared/<TUNNEL-UUID>.json

ingress:
  - hostname: jurassic.example.com
    service: http://127.0.0.1:4178
  - service: http_status:404
```

Run it as a service:

```bash
sudo cloudflared service install
sudo systemctl enable --now cloudflared
```

Then visit `https://jurassic.example.com/?dt=your-token` once on the iPhone and
**Share → Add to Home Screen**.

### Lock it down (recommended)

`WEB_TOKEN` is a thin guard. For real protection, add **Cloudflare Zero Trust →
Access → Application** on `jurassic.example.com` with a policy allowing only your
email (one-time PIN). Then the tunnel is only reachable after you authenticate
with Cloudflare, and you can drop `WEB_TOKEN` if you like.

## Offline note

A Cloudflare Tunnel needs internet on both ends — it's "reach my laptop from
anywhere", not "works on a plane". For genuinely offline access you'd sync the
files onto the phone (e.g. Jellyfin's download feature for the movies); that's a
separate setup from this web host.

## Playing MKV / HEVC on the phone

Not supported yet — Safari can't decode them and there's no server-side
transcode. Options if you need Dominion / Rebirth on the phone: re-encode those
two files to H.264 `.mp4`, or run Jellyfin alongside this (it transcodes on the
fly) and use it just for the Library.
