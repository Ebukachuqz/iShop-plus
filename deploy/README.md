# DigitalOcean Droplet deployment and recovery

This deploys only the FastAPI runtime. The Shopify embedded application and its Prisma
installation/session database remain a separate service and must retain their own storage.
No PostgreSQL migration or new commerce architecture is introduced.

## 1. Create the host and DNS

Create an Ubuntu 24.04 LTS Basic Droplet with an SSH key you own. Review the displayed
monthly price before creation. A small 2 GB host is a reasonable starting point for Docker
image builds; actual capacity must be measured. Do not add horizontal replicas.
Create an A record for a subdomain you control pointing to the Droplet IP. Only add an
AAAA record if IPv6 is configured and reachable. A bare Droplet IP is not the intended TLS setup.

Attach a DigitalOcean Cloud Firewall: inbound TCP 22 from your administrator IP only;
TCP 80 and 443 from all IPv4/IPv6 clients; outbound allow DNS and HTTPS (or default
outbound rules). Do not expose 8080 or any SQLite path. Keep an SSH session open while
changing SSH/firewall rules. Docker-published ports should be protected with the cloud
firewall rather than relying only on UFW. Only Caddy publishes ports in this compose file.

## 2. Install and prepare

Install Docker Engine and the Compose plugin using the official Ubuntu instructions:
https://docs.docker.com/engine/install/ubuntu/ . Enable the Docker service at boot.
Clone the intended iShop-plus revision into /opt/ishop-plus. These files must be pushed
or copied to the server before deploying; no automatic push/deployment is implied.

Run on the Droplet (Linux shell):

```sh
sudo systemctl enable --now docker
sudo install -d -m 700 /etc/ishop
sudo install -d -m 700 -o 10001 -g 10001 /var/lib/ishop /var/backups/ishop
sudo install -m 600 /dev/null /etc/ishop/runtime.env
sudo install -m 600 /dev/null /etc/ishop/deploy.env
sudoedit /etc/ishop/runtime.env
sudoedit /etc/ishop/deploy.env
```

runtime.env must contain the real values of SESSION_SIGNING_SECRET (identical to the
Shopify application's signing secret), RUNTIME_CONTROL_SECRET, DEV_ALLOWED_ORIGINS
(exact HTTPS storefront origins separated by commas), GEMINI_API_KEY, ELEVENLABS_API_KEY,
and GROQ_API_KEY if Groq is selected for ordinary chat. Set ELEVENLABS_VOICE_ID to an
account-accessible voice if overriding the tested default. Enable only intended Plus features.
Do not add secrets to Compose, the repository, image build arguments, or shell history.
Docker administrators can inspect container environment: treat Docker access as root access.

deploy.env contains only `RUNTIME_DOMAIN=drake.YOUR-DOMAIN` with your actual hostname.
Keep your local .env out of the image; the root .dockerignore excludes it.

## 3. Start and verify

```sh
cd /opt/ishop-plus
sudo docker compose --env-file /etc/ishop/deploy.env -f deploy/compose.yaml config --quiet
sudo docker compose --env-file /etc/ishop/deploy.env -f deploy/compose.yaml up -d --build
sudo docker compose --env-file /etc/ishop/deploy.env -f deploy/compose.yaml ps
curl --fail https://YOUR-RUNTIME-DOMAIN/health
```

Caddy obtains/renews TLS certificates and proxies WebSocket upgrades automatically.
DNS and inbound 80/443 must work for certificate issuance. Set the Shopify theme embed
URL to `wss://YOUR-RUNTIME-DOMAIN/ws`. The client appends /voice/SHOP. Configure the
Shopify application's server-side runtime URL to the HTTPS host as required by bootstrap.
The public proxy blocks /internal/*; revocations must be sent from a trusted host-side
admin connection to the private runtime network. Do not expose the revocation secret publicly.

runtime uses one process and a host-mounted database /var/lib/ishop/runtime.sqlite3.
The Linux entrypoint holds an exclusive advisory lock beside the database for its entire
lifetime; a second correctly configured runtime using that mount refuses startup. Never
launch ishop-runtime directly to bypass this guard, scale the service, or mount the same
database over network storage. The backup process is read-only on the source database.
The lock prevents a second application instance; SQLite still manages its own connections.

Restart policies restart exited containers and restore services after Docker/host reboot.
A failed health check alone does not restart a running container: monitor health/disk space
and investigate before a deliberate restart. Logs rotate. No raw access-log directive is enabled.

## 4. Backups

```sh
sudo cp deploy/ishop-backup.service deploy/ishop-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now ishop-backup.timer
sudo systemctl start ishop-backup.service
sudo journalctl -u ishop-backup.service --no-pager -n 20
```

Daily UTC snapshots use SQLite's online backup API (including committed WAL data), run
integrity_check, and atomically publish a mode-0600 backup in /var/backups/ishop.
Do not use cp on a running SQLite database. Snapshot files currently retain all versions:
monitor disk usage and manually prune only verified older backups after copying them off-host.
Host backups survive container replacement but NOT Droplet deletion/disk loss. Configure
an encrypted off-host backup destination or DigitalOcean backup policy before production;
no destination, encryption key, retention budget, or paid backup plan has been selected yet.
Test restoration periodically. Backups contain private session/cart data; restrict access.

## 5. Recovery and upgrades

Back up first, stop new shopper operations, wait for cart actions to finish, then stop the
runtime with `docker compose ... stop runtime`. Never restore while it is running.
Check a chosen snapshot with `sqlite3 SNAPSHOT 'PRAGMA integrity_check;'` on the host.
Preserve the current database AND its -wal/-shm sidecars together in a restricted recovery
folder. Install the verified snapshot as /var/lib/ishop/runtime.sqlite3, owned by 10001:10001
mode 0600; do not leave old WAL/SHM files at that destination. Never delete .writer.lock.
Start runtime using the same compose command and verify health and actual cart state.
Do not replay pending writes: startup reconciliation marks dispatched commands uncertain.
A backup restore can rewind the journal; close existing shopper tabs and start fresh sessions
before any new writes. Inspect affected carts manually; never retry an old approval.

For code upgrades retain the DB bind mount, build the chosen revision and recreate the
single runtime. Never use two runtime replicas for rolling deployment. SQLite survives
container restart/replacement, but in-memory mission proposals do not: shoppers must replan
and reapprove. This intentional behavior does not promise durable mission continuation.

## 6. Live acceptance

Verify HTTPS health; allowed and forbidden WebSocket origins; signed shopper bootstrap;
actual mic transcription and audible playback; image-to-real-catalogue matching; mission
research; reject with zero writes; exact approved basket additions with read-back; removal
of only test quantities; preservation of existing cart lines. Test restart/reconnect without
replaying writes. No live success is claimed until these checks actually run.

Current known provider blocker: fresh Gemma image requests returned HTTP 400 while text
planning worked. Deployment alone does not resolve this; investigate provider behavior.

## Sources and current verification boundary

- https://caddyserver.com/docs/automatic-https
- https://docs.docker.com/engine/containers/start-containers-automatically/
- https://docs.digitalocean.com/products/networking/firewalls/how-to/configure-rules/
- https://docs.python.org/3/library/sqlite3.html#sqlite3.Connection.backup

No Droplet exists yet. No paid infrastructure, DNS, firewall or live cart was changed.
Docker daemon is unavailable locally, so image execution/TLS/host locking remain unverified
until Docker or the Droplet is available. Backup logic has isolated regression tests.
