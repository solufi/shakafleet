# Shaka Agent — Raspberry Pi Vending Machine Controller

Agent logiciel qui tourne sur chaque Raspberry Pi pour contrôler une machine distributrice Shaka. Gère le clavier matriciel (AMS), le relais, le capteur de chute optique, le capteur de porte magnétique, la caméra et le paiement Nayax (Marshall Protocol).

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Raspberry Pi (aarch64)                   │
│                                                             │
│  ┌──────────────────┐   ┌──────────────────────────────┐    │
│  │  Shaka UI        │   │  shaka-kiosk (Chromium)      │    │
│  │  (Next.js :3000) │◄──│  Plein écran, auto-refresh   │    │
│  └────────┬─────────┘   └──────────────────────────────┘    │
│           │ HTTP                                            │
│  ┌────────▼─────────────────────────────────────────────┐   │
│  │  rpi_vend_server_stdlib.py (:5001)                   │   │
│  │  API REST — vend, door, payment, nayax               │   │
│  └──┬──────────────┬──────────────────┬─────────────────┘   │
│     │              │                  │                      │
│  ┌──▼──────────┐ ┌─▼───────────┐ ┌───▼──────────────────┐  │
│  │ shaka_      │ │ gpio_init   │ │ nayax_marshall.py    │  │
│  │ validation2 │ │ .py         │ │ (Marshall Protocol)  │  │
│  │ .py         │ │             │ │                      │  │
│  │ - Keypad    │ │ Safe state  │ │ ┌──────────────────┐ │  │
│  │ - Relay     │ │ au boot     │ │ │ shaka_nayax_     │ │  │
│  │ - Drop      │ │             │ │ │ service.py       │ │  │
│  │ - Door      │ │             │ │ │ (daemon)         │ │  │
│  └──────┬──────┘ └─────────────┘ │ └────────┬─────────┘ │  │
│         │                        │          │            │  │
│  ┌──────▼──────────────────┐     │  ┌───────▼──────────┐ │  │
│  │ GPIO (BCM)              │     │  │ USB-RS232        │ │  │
│  │ Keypad: 5,6,16,22-27   │     │  │ /dev/ttyUSB0     │ │  │
│  │ Relay:  GPIO 4          │     │  │ 115200 8N1       │ │  │
│  │ Drop:   GPIO 17 (IN)   │     │  └───────┬──────────┘ │  │
│  │ Door:   GPIO 12 (IN)   │     │          │            │  │
│  └─────────────────────────┘     │  ┌───────▼──────────┐ │  │
│                                  │  │ Nayax VPOS Touch │ │  │
│                                  │  │ (paiement carte) │ │  │
│                                  │  └──────────────────┘ │  │
│                                  └───────────────────────┘  │
│                                                             │
│  ┌──────────────────┐                                       │
│  │ camera_server.py │ ← USB Camera / mjpg-streamer          │
│  └──────────────────┘                                       │
└─────────────────────────────────────────────────────────────┘
         │ HTTP (heartbeat)
         ▼
┌─────────────────────────────┐
│  ShakaFleet Manager (cloud) │
│  fleet.shakadistribution.ca │
└─────────────────────────────┘
```

---

## Prérequis

- **Raspberry Pi 4/5** (aarch64, Raspberry Pi OS Bookworm)
- **Python 3.11+**
- **Node.js 18+** (pour l'UI Shaka-main)
- **Connexions matérielles :**
  - Clavier matriciel AMS (8 fils GPIO)
  - Relais 3.3V sur GPIO 4
  - Capteur optique de chute sur GPIO 17
  - Capteur magnétique de porte sur GPIO 12
  - Caméra USB
  - *(Optionnel)* Adaptateur USB-RS232 + Nayax VPOS Touch

---

## Installation rapide

### 1. Cloner le repo

```bash
git clone https://github.com/solufi/shakafleet.git
cd shakafleet/agent
```

### 2. Lancer l'installation

```bash
sudo bash install.sh
```

Ce script :
- Crée l'utilisateur `shaka` (si nécessaire)
- Installe les dépendances système et Python
- Copie les scripts dans `/home/shaka/`
- Installe les configs dans `/etc/default/`
- Installe et active les services systemd
- Démarre les services principaux

### 3. Vérifier

```bash
# Services
sudo systemctl status shaka-vend shaka-nayax shaka-gpio-init

# API
curl http://localhost:5001/health
curl http://localhost:5001/nayax/status
curl http://localhost:5001/door-status
```

---

## Installation manuelle (pas à pas)

### 1. Dépendances

```bash
sudo apt update
sudo apt install -y python3 python3-pip python3-rpi-lgpio chromium-browser unclutter xdotool curl git

sudo pip3 install --break-system-packages RPi.GPIO pyserial flask flask-cors
```

### 2. Copier les scripts

```bash
sudo cp *.py /home/shaka/
sudo cp shaka-kiosk.sh /home/shaka/
sudo chmod +x /home/shaka/shaka-kiosk.sh
sudo chown -R shaka:shaka /home/shaka/
```

### 3. Configs

```bash
sudo cp config/shaka-vend.env /etc/default/shaka-vend
sudo cp config/shaka-nayax.env /etc/default/shaka-nayax
```

### 4. Services systemd

```bash
sudo cp systemd/*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable shaka-gpio-init shaka-vend shaka-nayax shaka-camera shaka-kiosk shaka-ui
sudo systemctl start shaka-gpio-init shaka-vend shaka-nayax
```

---

## Configuration

### `/etc/default/shaka-vend`

| Variable | Défaut | Description |
|----------|--------|-------------|
| `PORT` | `5001` | Port du serveur HTTP vend |
| `SHAKA_SCRIPT` | `/home/shaka/shaka_validation2.py` | Script de contrôle keypad/relay/drop |
| `ACTIVE_LOW` | `0` | `1` si le montage est actif LOW |
| `PYTHON_BIN` | `/usr/bin/python3` | Chemin Python |

### `/etc/default/shaka-nayax`

| Variable | Défaut | Description |
|----------|--------|-------------|
| `NAYAX_SERIAL_PORT` | `/dev/ttyUSB0` | Port série USB-RS232 |
| `NAYAX_BAUD_RATE` | `115200` | Baud rate (Nayax default) |
| `NAYAX_SIMULATION` | `1` | `1` = simulation, `0` = vrai device |
| `NAYAX_DECIMAL_PLACES` | `2` | Décimales prix (Canada = 2) |
| `NAYAX_VEND_RESULT_TIMEOUT` | `30` | Timeout résultat vend (sec) |
| `NAYAX_SIM_APPROVAL_DELAY` | `3.0` | Délai approbation simulation (sec) |
| `NAYAX_SIM_AUTO_APPROVE` | `1` | `1` = auto-approuver en simulation |

---

## API Endpoints (port 5001)

### Vending

| Méthode | Route | Body | Description |
|---------|-------|------|-------------|
| `POST` | `/vend` | `{"location": "A1"}` ou `{"seq": "10#"}` ou `{"useRelay": true}` | Déclenche une vente (keypad ou relais) |
| `GET` | `/health` | — | Health check |
| `GET` | `/door-status` | — | État de la porte (ouverte/fermée) |

### Paiement Nayax

| Méthode | Route | Body | Description |
|---------|-------|------|-------------|
| `POST` | `/nayax/pay` | `{"items": [{"code": 1, "price": 350, "qty": 1}], "machineId": "shaka-001"}` | Démarre une session de paiement multi-vend |
| `GET` | `/nayax/status` | — | État courant Nayax + session |
| `POST` | `/nayax/vend-result` | `{"success": true}` | Rapporte le résultat du dispensing |
| `POST` | `/nayax/cancel` | — | Annule la session en cours |
| `POST` | `/nayax/reset` | — | Remet Nayax à idle |

### Paiement (legacy)

| Méthode | Route | Description |
|---------|-------|-------------|
| `GET` | `/payment-status` | État du paiement (fichier JSON) |
| `GET` | `/payment-status/set/{status}` | Set status (approved/denied/pending) |
| `GET` | `/payment-status/clear` | Efface le statut |

---

## Flux de paiement Nayax (Multi-Vend)

```
Client (UI)                    Vend Server (:5001)              Nayax VPOS Touch
    │                               │                               │
    │  POST /nayax/pay              │                               │
    │  {items, machineId}           │                               │
    │──────────────────────────────>│                               │
    │                               │  vend_request(items)          │
    │                               │──────────────────────────────>│
    │                               │                               │
    │                               │        "Présentez carte"      │
    │                               │<──────────────────────────────│
    │  GET /nayax/status            │                               │
    │  state: "waiting_payment"     │         Client tape carte     │
    │<──────────────────────────────│                               │
    │                               │                               │
    │                               │  authorization (approved)     │
    │                               │<──────────────────────────────│
    │  GET /nayax/status            │                               │
    │  state: "vend_approved"       │                               │
    │  payment_result: "approved"   │                               │
    │<──────────────────────────────│                               │
    │                               │                               │
    │  POST /vend {useRelay: true}  │                               │
    │──────────────────────────────>│  (dispense produit)           │
    │                               │                               │
    │  POST /nayax/vend-result      │                               │
    │  {success: true}              │  vend_success()               │
    │──────────────────────────────>│──────────────────────────────>│
    │                               │                               │
    │                               │  settlement (OK)              │
    │                               │<──────────────────────────────│
    │  GET /nayax/status            │                               │
    │  state: "session_complete"    │                               │
    │<──────────────────────────────│                               │
    │                               │                               │
    │  POST /nayax/reset            │                               │
    │──────────────────────────────>│  (prêt pour prochaine vente)  │
```

---

## GPIO Pinout (BCM)

### Clavier matriciel AMS

| Touche | GPIO A | GPIO B |
|--------|--------|--------|
| 1 | 24 | 25 |
| 2 | 5 | 24 |
| 3 | 22 | 25 |
| 4 | 5 | 22 |
| 5 | 23 | 25 |
| 6 | 5 | 23 |
| 7 | 25 | 27 |
| 8 | 5 | 27 |
| 9 | 25 | 6 |
| 0 | 5 | 6 |
| * | 26 | 6 |
| # | 16 | 6 |

### Autres GPIO

| Fonction | GPIO | Direction | Notes |
|----------|------|-----------|-------|
| Relais | 4 | OUT | 3.3V relay, 700ms pulse |
| Capteur chute | 17 | IN (PUD_UP) | Optique, FALLING edge |
| Capteur porte | 12 | IN (PUD_UP) | Reed switch, HIGH = ouverte |

---

## Services systemd

| Service | Description | Dépendances |
|---------|-------------|-------------|
| `shaka-gpio-init` | Init GPIO au boot (oneshot) | — |
| `shaka-vend` | Serveur HTTP vend (:5001) | gpio-init |
| `shaka-nayax` | Daemon paiement Nayax | vend |
| `shaka-camera` | Serveur caméra | — |
| `shaka-ui` | UI Next.js (:3000) | vend |
| `shaka-kiosk` | Chromium plein écran | graphical-session |

### Commandes utiles

```bash
# Voir les logs en temps réel
journalctl -u shaka-vend -f
journalctl -u shaka-nayax -f

# Redémarrer un service
sudo systemctl restart shaka-vend

# Redémarrer tout
sudo systemctl restart shaka-gpio-init shaka-vend shaka-nayax shaka-camera shaka-ui shaka-kiosk

# Voir l'état de tous les services Shaka
systemctl list-units 'shaka-*' --all
```

---

## Fichiers sur le RPi

```
/home/shaka/
├── shaka_validation2.py          # Contrôle keypad, relay, drop, door
├── rpi_vend_server_stdlib.py     # Serveur HTTP (port 5001)
├── rpi_vend_server.py            # Serveur Flask (alternatif)
├── nayax_marshall.py             # Module protocole Marshall (Nayax)
├── shaka_nayax_service.py        # Daemon Nayax
├── gpio_init.py                  # Init GPIO safe state
├── camera_server.py              # Serveur caméra
├── shaka-kiosk.sh                # Script kiosk Chromium
└── Shaka-main/                   # UI Next.js (repo séparé)

/etc/default/
├── shaka-vend                    # Config vend server
└── shaka-nayax                   # Config Nayax

/etc/systemd/system/
├── shaka-gpio-init.service
├── shaka-vend.service
├── shaka-nayax.service
├── shaka-camera.service
├── shaka-ui.service
└── shaka-kiosk.service
```

---

## Intégration Nayax VPOS Touch

### Mode simulation (actuel)

Le système fonctionne en mode simulation (`NAYAX_SIMULATION=1`). Les paiements sont auto-approuvés après 3 secondes. Cela permet de développer et tester le flux complet sans le vrai appareil.

### Quand le Nayax arrive

1. Brancher l'adaptateur USB-RS232 au VPOS Touch
2. Vérifier le port : `ls /dev/ttyUSB*`
3. Modifier `/etc/default/shaka-nayax` :
   ```
   NAYAX_SIMULATION=0
   NAYAX_SERIAL_PORT=/dev/ttyUSB0
   ```
4. Obtenir le SDK C de Nayax (après onboarding/certification)
5. Implémenter les fonctions dans `nayax_marshall.py` :
   - `_send_vend_request()` → appel SDK C via ctypes
   - `_send_vend_status()` → appel SDK C via ctypes
6. Redémarrer : `sudo systemctl restart shaka-vend shaka-nayax`

---

## Dupliquer sur une nouvelle machine

```bash
# 1. Sur le nouveau RPi, cloner le repo
git clone https://github.com/solufi/shakafleet.git
cd shakafleet/agent

# 2. Lancer l'installation
sudo bash install.sh

# 3. Ajuster la config selon le hardware
sudo nano /etc/default/shaka-vend    # ACTIVE_LOW, etc.
sudo nano /etc/default/shaka-nayax   # SIMULATION, port série, etc.

# 4. Installer l'UI (si nécessaire)
cd /home/shaka
git clone <repo-shaka-main> Shaka-main
cd Shaka-main && npm install && npm run build

# 5. Redémarrer
sudo systemctl restart shaka-gpio-init shaka-vend shaka-nayax shaka-ui shaka-kiosk
```

---

## Troubleshooting

| Problème | Solution |
|----------|----------|
| Relais inversé | Mettre `ACTIVE_LOW=1` dans `/etc/default/shaka-vend` |
| Port série non trouvé | Vérifier `ls /dev/ttyUSB*`, ajouter user au groupe `dialout` |
| GPIO permission denied | Exécuter en root ou ajouter user au groupe `gpio` |
| Keypad ne répond pas | Vérifier le câblage, tester avec `python3 shaka_validation2.py` (mode interactif) |
| Nayax timeout | Vérifier baud rate (115200), câble RS232, config Nayax Core |
| Door sensor inversé | Vérifier `DOOR_OPEN_STATE` dans `shaka_validation2.py` |
