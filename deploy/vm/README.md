# Fleet Manager VM Deploy (Ubuntu 24.04)

Domains:
- Admin UI: `fleet.shakadistribution.ca`
- Agent API (mTLS-only): `agent.shakadistribution.ca`

## 1) DNS
Create A records:
- `fleet.shakadistribution.ca` -> VM public static IP
- `agent.shakadistribution.ca` -> VM public static IP

## 2) VM firewall
Open:
- TCP 80
- TCP 443
- SSH (ideally IP allowlist)

Close everything else.

## 3) Files on VM
Copy this folder to the VM (example path):
- `/opt/fleet/deploy/vm`

## 4) Secrets / env
Create `/opt/fleet/deploy/vm/.env` from `.env.example`.

Generate secrets:

### bcrypt hash for ADMIN_PASSWORD_HASH (run locally)
```bash
node -e "const bcrypt=require('bcryptjs'); bcrypt.hash(process.argv[1], 12).then(console.log)" 'YOUR_STRONG_PASSWORD'
```

### AUTH_SECRET
Use a long random secret (32+ chars). Example:
```bash
openssl rand -base64 48
```

## 5) mTLS CA
Place your mTLS CA certificate at:
- `/opt/fleet/deploy/vm/nginx/mtls/ca.crt`

(Never place the CA private key on the VM.)

## 6) TLS certificates (Let's Encrypt)
This stack expects certs to exist on the VM at:
- `/etc/letsencrypt/live/fleet.shakadistribution.ca/fullchain.pem`
- `/etc/letsencrypt/live/fleet.shakadistribution.ca/privkey.pem`
- `/etc/letsencrypt/live/agent.shakadistribution.ca/fullchain.pem`
- `/etc/letsencrypt/live/agent.shakadistribution.ca/privkey.pem`

You can obtain them with certbot (host install) or an ACME container workflow.

## 7) Start
From `/opt/fleet/deploy/vm`:
```bash
docker compose pull
docker compose up -d
```

## 8) Notes
- `nginx` is the only public entrypoint (80/443).
- `postgres` and `minio` are internal to Docker network.
- `/login` is rate-limited in Nginx.
