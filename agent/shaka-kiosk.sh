#!/bin/bash

# Configuration Kiosk Shaka
KIOSK_URL="http://127.0.0.1:3000"
KIOSK_PROFILE_DIR="/home/shaka/.cache/chromium-kiosk"
CACHE_BUST=$(date +%s)

# Créer le profil kiosk si inexistant
mkdir -p "${KIOSK_PROFILE_DIR}"

# Configuration écran
xset s off
xset s noblank
xset -dpms

# Cacher le curseur après inactivité
unclutter -idle 0.5 -root &

# Démarrer Chromium Kiosk avec flags optimisés
exec /usr/bin/chromium \
  --kiosk \
  --start-fullscreen \
  --window-size=1920,1080 \
  --window-position=0,0 \
  --user-data-dir="${KIOSK_PROFILE_DIR}" \
  "${KIOSK_URL}?v=${CACHE_BUST}" \
  --no-first-run \
  --no-default-browser-check \
  --disable-infobars \
  --disable-extensions \
  --disable-sync \
  --disable-translate \
  --noerrdialogs \
  --disable-session-crashed-bubble \
  --disable-gpu \
  --disable-software-rasterizer \
  --disable-dev-shm-usage \
  --force-device-scale-factor=1 \
  --disable-background-timer-throttling \
  --disable-backgrounding-occluded-windows \
  --disable-renderer-backgrounding \
  --disable-features=TranslateUI \
  --disable-ipc-flooding-protection \
  >>/home/shaka/kiosk.log 2>&1
