# Deploying Maestro Connect on a Hyper-V Ubuntu VM

Step-by-step instructions for hosting the Maestro Connect app (and optionally the
docs site) on a new Ubuntu virtual machine under Hyper-V, for ClearAlan-internal
use.

## What runs where

| Component | Where it runs | Notes |
|---|---|---|
| **App** (this repo → `dist/`) | The Ubuntu VM, served by nginx | Static single-page app + PWA. No server-side code. |
| **Docs site** (`docs/` → `docs/dist/`) | The VM (optional) | Static. Currently at docs.maestroconnect.clearalan.ca. |
| **API** (`api/`) | Cloudflare Workers — **not** the VM | Uses Cloudflare D1 (SQLite) and R2 (object storage); it cannot run on a plain Linux host. Sign-in, the ClearAlan device library, and cloud saves all go through it. |
| **Device database site** | Cloudflare (devices.maestroconnect.clearalan.ca) | Unchanged by this deployment. |
| **MCP bridge / git server** (`mcp-server/`) | Each user's own computer | Never on the VM — it binds 127.0.0.1 and works against the user's local repos. |

Two deployment modes for the app build:

- **Connected (default)** — the SPA on the VM talks to the existing Cloudflare
  API for login, the shared device library, and cloud saves. Requires one CORS
  change on the API (step 8).
- **Fully offline** — no API at all; the cloud UI is hidden and everything stays
  in the browser. Set an empty `VITE_TEMPLATE_API_URL` (step 5) and skip step 8.

---

## 1. Create the VM in Hyper-V

In **Hyper-V Manager → New → Virtual Machine**:

- **Generation:** 2
- **Memory:** 4096 MB minimum (8192 MB recommended if you build on the VM), dynamic memory on
- **Virtual switch:** an **External** switch bound to the host's physical NIC, so the VM is reachable from the LAN. Create one first under *Virtual Switch Manager* if you only have the Default Switch (the Default Switch is NAT'd and unreachable from other machines).
- **Disk:** 40 GB VHDX
- **Install media:** Ubuntu Server 24.04 LTS ISO (<https://ubuntu.com/download/server>)

Before first boot, in the VM's **Settings**:

- **Security:** keep Secure Boot enabled but set the template to **Microsoft UEFI Certificate Authority** (Ubuntu won't boot under the default Windows template).
- **Processor:** 2–4 virtual processors.
- **Checkpoints:** production checkpoints are fine; take one after setup completes.

Install Ubuntu Server with the OpenSSH server option ticked. Give the VM a
static IP — either a DHCP reservation on your router/DHCP server (simplest) or a
static netplan config. Note the address; it's used everywhere below (examples
use `10.0.0.50` and the hostname `maestro.clearalan.local`).

## 2. Base system setup

SSH in from the host, then:

```bash
sudo apt update && sudo apt -y upgrade
sudo apt -y install git nginx ufw
sudo ufw allow OpenSSH
sudo ufw allow "Nginx Full"
sudo ufw enable
```

## 3. Install Node.js 22 LTS

The build needs Node 22 (matches development). Via NodeSource:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt -y install nodejs
node --version   # v22.x
```

## 4. Get the source

Clone from Azure DevOps (you'll be prompted for your ClearAlan PAT):

```bash
sudo mkdir -p /opt/maestro && sudo chown "$USER" /opt/maestro
git clone "https://ClearAlanInc@dev.azure.com/ClearAlanInc/ClearAlan%20Inc/_git/caDesign" /opt/maestro/app
cd /opt/maestro/app
git checkout self-hosted-offline-mode
```

> Tip: for unattended updates later, store the credential once with
> `git config credential.helper store` and do one authenticated fetch, or use a
> read-only PAT baked into the remote URL.

## 5. Build the app

```bash
cd /opt/maestro/app
npm ci
npm run build:selfhosted
```

This produces `dist/`. The `selfhosted` mode reads `.env.selfhosted`, which
points at the ClearAlan API/devices/docs hosts and disables all other external
contact.

**Fully-offline variant:** before building, create `.env.selfhosted.local`
(git-ignored) containing:

```
VITE_TEMPLATE_API_URL=
```

The build then hides login/cloud/library-sync UI entirely and the app never
calls out. You can also repoint `VITE_DOCS_URL` here if you host the docs on
this VM (step 6).

## 6. Build the docs site (optional)

```bash
cd /opt/maestro/app/docs
npm ci
npm run build
```

Produces `docs/dist/`. If you serve docs from this VM, rebuild the app with
`VITE_DOCS_URL` in `.env.selfhosted.local` pointing at the VM's docs URL so the
in-app help links stay correct.

## 7. Serve with nginx

```bash
sudo mkdir -p /var/www/maestro /var/www/maestro-docs
sudo rsync -a --delete /opt/maestro/app/dist/ /var/www/maestro/
sudo rsync -a --delete /opt/maestro/app/docs/dist/ /var/www/maestro-docs/   # if built
```

Create `/etc/nginx/sites-available/maestro`:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name maestro.clearalan.local;   # or the VM's IP

    root /var/www/maestro;
    index index.html;

    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;

    # Hashed build assets are immutable
    location /assets/ {
        add_header Cache-Control "public, max-age=31536000, immutable";
    }

    # The PWA update flow requires these to always be revalidated —
    # long-caching index.html or the service worker strands users on old builds.
    location = /index.html { add_header Cache-Control "no-cache"; }
    location = /sw.js      { add_header Cache-Control "no-cache"; }
    location = /manifest.webmanifest { add_header Cache-Control "no-cache"; }

    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }
}

# Optional docs site on its own name
server {
    listen 80;
    listen [::]:80;
    server_name maestro-docs.clearalan.local;
    root /var/www/maestro-docs;
    index index.html;
    location / { try_files $uri $uri/ /index.html; }
}
```

Enable it:

```bash
sudo ln -s /etc/nginx/sites-available/maestro /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx
```

## 8. HTTPS — required for full functionality

Browsers only grant a **secure context** to `https://` origins (and
`localhost`). Over plain `http://` on a LAN address:

- the **PWA/service worker never installs** — no offline caching, no update pill;
- `crypto.randomUUID` is unavailable, which breaks parts of the app.

So HTTPS is effectively required. Options, best first:

1. **Internal CA / AD CS certificate** for `maestro.clearalan.local` (plus an
   internal DNS A record pointing at the VM). Install the cert + key and add to
   the server block:

   ```nginx
   listen 443 ssl;
   ssl_certificate     /etc/ssl/certs/maestro.crt;
   ssl_certificate_key /etc/ssl/private/maestro.key;
   ```

   Every ClearAlan machine that trusts the internal CA gets a green padlock.

2. **Let's Encrypt** (`sudo apt install certbot python3-certbot-nginx`) — only
   if the name is publicly resolvable and port 80 is reachable from the
   internet, or you can do DNS-01 validation for `clearalan.ca`.

3. **mkcert** for a quick pilot — generates a locally-trusted cert, but its root
   must be installed on every client machine.

Redirect HTTP → HTTPS once the cert works:

```nginx
server { listen 80; server_name maestro.clearalan.local; return 301 https://$host$request_uri; }
```

## 9. Allow the new origin on the API (connected mode only)

The Cloudflare API only accepts credentialed requests (login, library sync,
cloud saves) from origins listed in `ALLOWED_ORIGINS`. Add the VM's origin in
`api/wrangler.toml`:

```toml
ALLOWED_ORIGINS = "https://maestroconnect.clearalan.ca,https://www.maestroconnect.clearalan.ca,https://devices.maestroconnect.clearalan.ca,https://maestro.clearalan.local"
```

then redeploy the worker from any machine with Cloudflare access:

```bash
cd api && npx wrangler deploy
```

Without this, the app loads but sign-in and every cloud feature fail with CORS
errors. (Microsoft Entra sign-in needs no change — its redirect URI is on the
API host, which is unchanged.)

## 10. Updating to a new version

```bash
cd /opt/maestro/app
git pull
npm ci
npm run build:selfhosted
sudo rsync -a --delete dist/ /var/www/maestro/
# docs, if hosted here:
cd docs && npm ci && npm run build && sudo rsync -a --delete dist/ /var/www/maestro-docs/
```

No service restart is needed — nginx serves the new files immediately, and open
browser tabs pick the update up through the PWA update pill (or a reload).
Worth wrapping in `/opt/maestro/update.sh` for one-command updates.

## 11. Smoke test

From another machine on the LAN:

1. `https://maestro.clearalan.local` loads the landing page; **Open Editor** works.
2. DevTools → Application → Service Workers shows the worker **activated** (proves the secure context is right).
3. Drop a device on the canvas, reload — the drawing survives (browser autosave).
4. Connected mode: Log in (Microsoft), confirm the device pane shows the ClearAlan library without a "couldn't reach" banner, and Save to Cloud round-trips.
5. Disconnect the client from the network, reload the app — it still loads (PWA offline cache).

## Notes & gotchas

- **User data lives in each browser**, not on the VM — the VM serves code only.
  Backing up the VM does not back up drawings; users' cloud saves live in
  Cloudflare (D1/R2), and local files/git saves live wherever users put them.
- **Serving by bare IP** (`https://10.0.0.50`) works but certificates for IPs
  are awkward — prefer an internal DNS name.
- **Hyper-V checkpoints**: take one before OS upgrades; avoid reverting a VM
  that users are actively hitting (nginx content would silently roll back).
- The VM needs outbound internet only during builds (`npm ci`) and git pulls;
  serving is fully self-contained.
