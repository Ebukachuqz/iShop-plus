# Runtime deployment

Build from repository root with `docker build -f deploy/runtime.Dockerfile -t ishop-runtime .`.
On DigitalOcean App Platform select this Dockerfile, HTTP port 8080, one instance,
and HTTP health check `/health`. Never run multiple workers with current in-memory missions.
Set RUNTIME_HOST=0.0.0.0. PORT is honored unless RUNTIME_PORT explicitly overrides it.

Configure SESSION_SIGNING_SECRET (same as Shopify app), RUNTIME_CONTROL_SECRET,
DEV_ALLOWED_ORIGINS (exact HTTPS storefront origins), GEMINI_API_KEY,
ELEVENLABS_API_KEY and the ordinary-chat provider credential in encrypted settings.
Set the theme embed runtime URL to wss://YOUR-HOST/ws; the transport adds /voice/SHOP.
Do not enable alternate speech providers. Never copy .env into the image.

App Platform storage is ephemeral. SQLite command journal/session state and in-memory
mission proposals are not durable across redeploys. This deployment is single-instance,
not a durable production checkout service. Do not redeploy while an approved cart action
is outstanding. A restart requires cart inspection and a fresh proposal; never replay writes.
Use a persistent volume on a suitable host or add a durable database adapter before
promising durable sessions. App Platform local SQLite is not that adapter.

Verify /health over HTTPS, origin rejection, signed WSS authentication, microphone
permission, actual audible reply, image-to-catalogue retrieval, rejected proposal with
zero writes, and approved basket read-back preserving existing lines. Health is local
configuration evidence only; it does not prove provider availability.

No deployment was created or changed during the audit: doctl/account access and a
confirmed live endpoint were unavailable. Supply these before requesting live validation.

References: [App Platform storage](https://docs.digitalocean.com/products/app-platform/how-to/store-data/),
[app specification](https://docs.digitalocean.com/products/app-platform/reference/app-spec/).
