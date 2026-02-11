# Shaka Fleet

Plateforme complète pour la gestion d'un parc de machines distributrices Shaka.

Ce repo contient **deux composantes** :

| Composante | Dossier | Description |
|------------|---------|-------------|
| **Fleet Manager** | `src/` | Dashboard web (Next.js) pour monitorer et gérer toutes les machines à distance |
| **Agent RPi** | `agent/` | Logiciel embarqué sur chaque Raspberry Pi : contrôle hardware, paiement Nayax, API locale |

---

## Fleet Manager (Dashboard)

Dashboard web déployé sur VM / cloud pour la gestion centralisée du parc.

- **Stack** : Next.js 14, TailwindCSS, TypeScript
- **Fonctionnalités** : monitoring machines, inventaire, snapshots caméra, OTA, heartbeats
- **Déploiement** : Docker (GHCR) + Nginx + PostgreSQL + MinIO

### Lancer en dev

```bash
npm install
npm run dev
```

### Docker

```bash
docker build -t shakafleet .
docker run -p 3000:3000 shakafleet
```

### VM Deploy

Voir `deploy/vm/README.md` pour le déploiement complet avec docker-compose (Nginx + mTLS + PostgreSQL + MinIO).

### GHCR

Image publiée automatiquement sur chaque push à `main` :
- `ghcr.io/solufi/shakafleet:latest`
- Multi-arch : amd64 + arm64

---

## Agent RPi (Machine)

Logiciel embarqué sur chaque Raspberry Pi qui contrôle le hardware de la machine distributrice.

**Voir [`agent/README.md`](agent/README.md) pour la documentation complète.**

### Fonctionnalités

- **Clavier matriciel AMS** — émulation keypad pour sélection produit
- **Relais GPIO** — contrôle direct du mécanisme de distribution
- **Capteur de chute optique** — validation de la livraison produit
- **Capteur de porte magnétique** — détection ouverture/fermeture
- **Capteur de proximité** — TeraRanger Evo Swipe Plus (présence, gestes, engagement)
- **Paiement Nayax** — protocole Marshall via RS232 (VPOS Touch)
- **Caméra USB** — snapshots et streaming
- **Kiosk Chromium** — interface client plein écran

### Installation rapide sur un nouveau RPi

```bash
git clone https://github.com/solufi/shakafleet.git
cd shakafleet/agent
sudo bash install.sh
```

### API locale (port 5001)

| Route | Description |
|-------|-------------|
| `POST /vend` | Déclenche une vente (keypad ou relais) |
| `POST /nayax/pay` | Démarre un paiement Nayax (multi-vend) |
| `GET /nayax/status` | État du paiement en cours |
| `GET /proximity/status` | État du capteur de proximité |
| `GET /door-status` | État de la porte |
| `GET /health` | Health check |

---

## Structure du repo

```
shakafleet/
├── src/                          # Fleet Manager (Next.js)
│   ├── app/
│   │   ├── api/                  # API routes (machines, heartbeat, auth)
│   │   ├── machines/             # Page machines
│   │   ├── agents/               # Page agents
│   │   └── login/                # Auth
│   └── lib/                      # Shared libs
├── agent/                        # Agent RPi
│   ├── shaka_validation2.py      # Contrôle keypad, relay, drop, door
│   ├── rpi_vend_server_stdlib.py # Serveur HTTP (port 5001)
│   ├── nayax_marshall.py         # Protocole Marshall (Nayax)
│   ├── shaka_nayax_service.py    # Daemon Nayax
│   ├── shaka_proximity.py        # Daemon capteur proximité
│   ├── proximity_logger.py       # Logging SQLite événements proximité
│   ├── shaka_heartbeat.py        # Heartbeat vers Fleet Manager
│   ├── evo_swipe_plus/           # Driver TeraRanger Evo Swipe Plus
│   ├── gpio_init.py              # Init GPIO safe state
│   ├── shaka-kiosk.sh            # Script kiosk Chromium
│   ├── install.sh                # Script d'installation automatique
│   ├── config/                   # Fichiers de config (.env)
│   ├── systemd/                  # Services systemd
│   └── README.md                 # Doc complète agent
├── deploy/
│   └── vm/                       # Docker-compose + Nginx pour le fleet manager
├── scripts/                      # Scripts utilitaires
├── Dockerfile                    # Build fleet manager
└── README.md                     # Ce fichier
```
