#!/usr/bin/env bash
# =============================================================================
# Shaka Agent - Installation Script
# =============================================================================
# Usage: sudo bash install.sh
#
# This script sets up a fresh Raspberry Pi as a Shaka vending machine agent.
# It copies scripts, configs, and systemd services, then enables everything.
# =============================================================================

set -euo pipefail

SHAKA_USER="shaka"
SHAKA_HOME="/home/${SHAKA_USER}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[INSTALL]${NC} $*"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
err()  { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

# --- Pre-checks ---
if [[ $EUID -ne 0 ]]; then
    err "This script must be run as root (sudo bash install.sh)"
fi

if ! id "${SHAKA_USER}" &>/dev/null; then
    log "Creating user ${SHAKA_USER}..."
    useradd -m -s /bin/bash "${SHAKA_USER}"
    usermod -aG gpio,video,dialout "${SHAKA_USER}"
else
    log "User ${SHAKA_USER} already exists"
    usermod -aG gpio,video,dialout "${SHAKA_USER}" 2>/dev/null || true
fi

# --- System dependencies ---
log "Installing system dependencies..."
apt-get update -qq
apt-get install -y -qq python3 python3-pip python3-venv python3-rpi-lgpio \
    chromium-browser unclutter xdotool curl git

# --- Python dependencies ---
log "Installing Python packages..."
pip3 install --break-system-packages RPi.GPIO pyserial flask flask-cors crcmod 2>/dev/null || \
pip3 install RPi.GPIO pyserial flask flask-cors crcmod

# --- Copy agent scripts ---
log "Copying agent scripts to ${SHAKA_HOME}..."
SCRIPTS=(
    "shaka_validation2.py"
    "rpi_vend_server_stdlib.py"
    "rpi_vend_server.py"
    "nayax_marshall.py"
    "shaka_nayax_service.py"
    "gpio_init.py"
    "shaka-kiosk.sh"
    "shaka_proximity.py"
    "proximity_logger.py"
)

for script in "${SCRIPTS[@]}"; do
    if [[ -f "${SCRIPT_DIR}/${script}" ]]; then
        cp "${SCRIPT_DIR}/${script}" "${SHAKA_HOME}/${script}"
        chown "${SHAKA_USER}:${SHAKA_USER}" "${SHAKA_HOME}/${script}"
        log "  -> ${script}"
    else
        warn "  -> ${script} not found, skipping"
    fi
done

chmod +x "${SHAKA_HOME}/shaka-kiosk.sh" 2>/dev/null || true

# --- Copy Evo Swipe Plus driver ---
if [[ -d "${SCRIPT_DIR}/evo_swipe_plus" ]]; then
    cp -r "${SCRIPT_DIR}/evo_swipe_plus" "${SHAKA_HOME}/evo_swipe_plus"
    chown -R "${SHAKA_USER}:${SHAKA_USER}" "${SHAKA_HOME}/evo_swipe_plus"
    log "  -> evo_swipe_plus/"
fi

# --- Copy environment configs ---
log "Installing environment configs..."
if [[ -f "${SCRIPT_DIR}/config/shaka-vend.env" ]]; then
    cp "${SCRIPT_DIR}/config/shaka-vend.env" /etc/default/shaka-vend
    log "  -> /etc/default/shaka-vend"
fi

if [[ -f "${SCRIPT_DIR}/config/shaka-nayax.env" ]]; then
    cp "${SCRIPT_DIR}/config/shaka-nayax.env" /etc/default/shaka-nayax
    log "  -> /etc/default/shaka-nayax"
fi

if [[ -f "${SCRIPT_DIR}/config/shaka-proximity.env" ]]; then
    cp "${SCRIPT_DIR}/config/shaka-proximity.env" /etc/default/shaka-proximity
    log "  -> /etc/default/shaka-proximity"
fi

# --- Install systemd services ---
log "Installing systemd services..."
SERVICES=(
    "shaka-gpio-init.service"
    "shaka-vend.service"
    "shaka-nayax.service"
    "shaka-proximity.service"
    "shaka-camera.service"
    "shaka-kiosk.service"
    "shaka-ui.service"
)

for svc in "${SERVICES[@]}"; do
    if [[ -f "${SCRIPT_DIR}/systemd/${svc}" ]]; then
        cp "${SCRIPT_DIR}/systemd/${svc}" "/etc/systemd/system/${svc}"
        log "  -> ${svc}"
    else
        warn "  -> ${svc} not found, skipping"
    fi
done

# --- Enable services ---
log "Reloading systemd and enabling services..."
systemctl daemon-reload

# Core services (always enable)
systemctl enable shaka-gpio-init.service
systemctl enable shaka-vend.service
systemctl enable shaka-nayax.service
systemctl enable shaka-proximity.service 2>/dev/null || true

# Optional services (enable if config exists)
systemctl enable shaka-camera.service 2>/dev/null || true
systemctl enable shaka-kiosk.service 2>/dev/null || true
systemctl enable shaka-ui.service 2>/dev/null || true

# --- Start core services ---
log "Starting core services..."
systemctl start shaka-gpio-init.service || warn "GPIO init failed (may need reboot)"
systemctl start shaka-vend.service
systemctl start shaka-nayax.service
systemctl start shaka-proximity.service || warn "Proximity sensor not found (check USB)"

# --- Summary ---
echo ""
echo "============================================="
echo -e "${GREEN}  Shaka Agent installed successfully!${NC}"
echo "============================================="
echo ""
echo "Services:"
systemctl --no-pager status shaka-vend.service shaka-nayax.service shaka-proximity.service 2>/dev/null | grep -E "Active:|●" || true
echo ""
echo "Config files:"
echo "  /etc/default/shaka-vend"
echo "  /etc/default/shaka-nayax"
echo "  /etc/default/shaka-proximity"
echo ""
echo "Test:"
echo "  curl http://localhost:5001/health"
echo "  curl http://localhost:5001/nayax/status"
echo "  curl http://localhost:5001/proximity/status"
echo ""
echo "Logs:"
echo "  journalctl -u shaka-vend -f"
echo "  journalctl -u shaka-nayax -f"
echo "  journalctl -u shaka-proximity -f"
echo ""
echo "Next steps:"
echo "  1. Edit /etc/default/shaka-vend (ACTIVE_LOW, etc.)"
echo "  2. Edit /etc/default/shaka-nayax (NAYAX_SIMULATION=0 when device ready)"
echo "  3. Install Shaka-main UI in ${SHAKA_HOME}/Shaka-main/"
echo "  4. sudo systemctl restart shaka-vend shaka-nayax"
echo ""
