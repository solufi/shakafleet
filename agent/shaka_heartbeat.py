#!/usr/bin/env python3
"""
Shaka Heartbeat Service
========================
Daemon that periodically sends heartbeat data to the ShakaFleet Manager.
Collects status from local services (vend server, proximity, nayax, door)
and sends a consolidated payload to the fleet manager API.

Runs as systemd service: shaka-heartbeat.service
"""
from __future__ import annotations

import base64
import json
import logging
import os
import platform
import signal
import socket
import subprocess
import sys
import time
import urllib.request
import urllib.error
from typing import Any, Dict, List, Optional

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("shaka-heartbeat")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
FLEET_URL = os.getenv("FLEET_URL", "https://fleet.shakadistribution.ca")
HEARTBEAT_ENDPOINT = os.getenv("HEARTBEAT_ENDPOINT", "/api/heartbeat")
MACHINE_ID = os.getenv("MACHINE_ID", socket.gethostname())
MACHINE_LOCATION = os.getenv("MACHINE_LOCATION", "")
HEARTBEAT_INTERVAL = int(os.getenv("HEARTBEAT_INTERVAL", "30"))
VEND_SERVER_PORT = int(os.getenv("VEND_SERVER_PORT", "5001"))
FIRMWARE_VERSION = os.getenv("FIRMWARE_VERSION", "1.0.0")
AGENT_VERSION = "2.1.0"
CAMERA_SERVER_PORT = int(os.getenv("CAMERA_SERVER_PORT", "5002"))
CAMERA_IDS = [int(x) for x in os.getenv("CAMERA_IDS", "0").split(",") if x.strip()]
SNAPSHOT_INTERVAL = int(os.getenv("SNAPSHOT_INTERVAL", "300"))  # every 5 min
PRODUCTS_FILE = os.getenv("PRODUCTS_FILE", "/home/shaka/Shaka-main/local-cache/products.json")
INVENTORY_FILE = os.getenv("INVENTORY_FILE", "/home/shaka/Shaka-main/local-cache/inventory.json")

_running = True


# ---------------------------------------------------------------------------
# Data collection helpers
# ---------------------------------------------------------------------------
def _local_get(path: str, timeout: float = 3.0) -> Optional[Dict[str, Any]]:
    """GET request to the local vend server."""
    try:
        url = f"http://127.0.0.1:{VEND_SERVER_PORT}{path}"
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode())
    except Exception:
        return None


def get_uptime() -> str:
    """Get system uptime as a human-readable string."""
    try:
        with open("/proc/uptime", "r") as f:
            seconds = float(f.read().split()[0])
        days = int(seconds // 86400)
        hours = int((seconds % 86400) // 3600)
        minutes = int((seconds % 3600) // 60)
        return f"{days}j {hours}h {minutes}m"
    except Exception:
        return "unknown"


def get_cpu_temp() -> float:
    """Get CPU temperature in Celsius."""
    try:
        with open("/sys/class/thermal/thermal_zone0/temp", "r") as f:
            return round(int(f.read().strip()) / 1000.0, 1)
    except Exception:
        return 0.0


def get_local_ip() -> str:
    """Get the local IP address."""
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "unknown"


def get_public_ip() -> str:
    """Get the public IP address via external service."""
    for url in ["https://api.ipify.org", "https://ifconfig.me/ip", "https://icanhazip.com"]:
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "curl/7.0"})
            with urllib.request.urlopen(req, timeout=5) as resp:
                ip = resp.read().decode().strip()
                if ip and len(ip) < 50:
                    return ip
        except Exception:
            continue
    return "unknown"


def get_memory_usage() -> Dict[str, Any]:
    """Get RAM usage."""
    try:
        with open("/proc/meminfo", "r") as f:
            lines = f.readlines()
        info = {}
        for line in lines:
            parts = line.split()
            if len(parts) >= 2:
                info[parts[0].rstrip(":")] = int(parts[1])  # kB
        total = info.get("MemTotal", 0)
        available = info.get("MemAvailable", 0)
        used = total - available
        return {
            "total_mb": round(total / 1024),
            "used_mb": round(used / 1024),
            "available_mb": round(available / 1024),
            "percent": round(used / total * 100, 1) if total > 0 else 0,
        }
    except Exception:
        return {}


def collect_inventory() -> Optional[Dict[str, Any]]:
    """Collect product inventory from local files."""
    products: List[Dict[str, Any]] = []
    inventory: Dict[str, Any] = {}

    # Try products.json
    try:
        if os.path.exists(PRODUCTS_FILE):
            with open(PRODUCTS_FILE, "r") as f:
                products = json.load(f)
    except Exception:
        pass

    # Try inventory.json
    try:
        if os.path.exists(INVENTORY_FILE):
            with open(INVENTORY_FILE, "r") as f:
                inventory = json.load(f)
    except Exception:
        pass

    # Also try the local API
    if not products:
        data = _local_get("/local-products")
        if data and isinstance(data, list):
            products = data

    if not products and not inventory:
        return None

    return {
        "products": products,
        "inventory": inventory,
        "totalProducts": len(products),
    }


# Snapshot cache to avoid capturing too frequently
_last_snapshot_time: float = 0
_last_snapshot_data: Optional[Dict[str, str]] = None


def collect_snapshots() -> Optional[Dict[str, str]]:
    """Capture camera snapshots as base64 JPEG. Cached per SNAPSHOT_INTERVAL."""
    global _last_snapshot_time, _last_snapshot_data

    now = time.time()
    if _last_snapshot_data and (now - _last_snapshot_time) < SNAPSHOT_INTERVAL:
        return _last_snapshot_data

    snapshots: Dict[str, str] = {}
    for cam_id in CAMERA_IDS:
        try:
            url = f"http://127.0.0.1:{CAMERA_SERVER_PORT}/camera/{cam_id}"
            req = urllib.request.Request(url)
            with urllib.request.urlopen(req, timeout=10) as resp:
                img_data = resp.read()
                if len(img_data) > 100:  # sanity check
                    b64 = base64.b64encode(img_data).decode("ascii")
                    snapshots[f"camera_{cam_id}"] = b64
        except Exception as e:
            logger.debug(f"Snapshot camera {cam_id} failed: {e}")

    if snapshots:
        _last_snapshot_time = now
        _last_snapshot_data = snapshots
        return snapshots

    return _last_snapshot_data  # return stale if fresh capture failed


def get_disk_usage() -> Dict[str, Any]:
    """Get disk usage for the root partition."""
    try:
        st = os.statvfs("/")
        total = st.f_blocks * st.f_frsize
        free = st.f_bavail * st.f_frsize
        used = total - free
        return {
            "total_gb": round(total / (1024**3), 1),
            "used_gb": round(used / (1024**3), 1),
            "free_gb": round(free / (1024**3), 1),
            "percent": round(used / total * 100, 1) if total > 0 else 0,
        }
    except Exception:
        return {}


def collect_sensors() -> Dict[str, Any]:
    """Collect sensor data from local endpoints."""
    sensors: Dict[str, Any] = {
        "temp": get_cpu_temp(),
        "doorOpen": False,
    }

    # Door status
    door = _local_get("/door-status")
    if door and door.get("ok"):
        sensors["doorOpen"] = door.get("isOpen", False)

    return sensors


def collect_proximity() -> Optional[Dict[str, Any]]:
    """Collect full proximity analytics for heartbeat."""
    result: Dict[str, Any] = {}

    # Summary (compact totals)
    summary = _local_get("/proximity/summary")
    if summary and summary.get("ok"):
        summary.pop("ok", None)
        result["summary"] = summary

    # Today stats (hourly breakdown)
    today = _local_get("/proximity/stats/today")
    if today and today.get("ok"):
        today.pop("ok", None)
        result["today"] = today

    # Weekly stats
    week = _local_get("/proximity/stats/week")
    if week and week.get("ok"):
        week.pop("ok", None)
        result["week"] = week

    # Recent events (last 30)
    events = _local_get("/proximity/events")
    if events and events.get("ok"):
        result["events"] = (events.get("events") or [])[:30]

    # Live sensor status
    status = _local_get("/proximity/status")
    if status and status.get("ok"):
        result["live"] = {
            "connected": status.get("connected", False),
            "mode": status.get("mode", "unknown"),
            "presence": status.get("presence"),
            "engagement": status.get("engagement"),
            "distance_mm": status.get("distance_mm"),
            "gesture": status.get("gesture"),
        }

    return result if result else None


def collect_nayax() -> Optional[Dict[str, Any]]:
    """Collect Nayax status."""
    status = _local_get("/nayax/status")
    if status and status.get("ok"):
        result = {
            "connected": status.get("connected", False),
            "simulation": status.get("simulation", True),
            "state": status.get("state", "unknown"),
        }
        if "link" in status:
            result["link"] = status["link"]
        return result
    return None


def check_services() -> Dict[str, str]:
    """Check status of all shaka systemd services."""
    services = {}
    for svc in ["shaka-vend", "shaka-nayax", "shaka-proximity", "shaka-camera", "shaka-ui", "shaka-kiosk"]:
        try:
            result = subprocess.run(
                ["systemctl", "is-active", f"{svc}.service"],
                capture_output=True, text=True, timeout=3
            )
            services[svc] = result.stdout.strip()
        except Exception:
            services[svc] = "unknown"
    return services


# ---------------------------------------------------------------------------
# Heartbeat sender
# ---------------------------------------------------------------------------
def build_payload() -> Dict[str, Any]:
    """Build the full heartbeat payload."""
    health = _local_get("/health")
    vend_ok = health is not None and health.get("ok", False)

    payload: Dict[str, Any] = {
        "machineId": MACHINE_ID,
        "status": "online" if vend_ok else "degraded",
        "sensors": collect_sensors(),
        "firmware": FIRMWARE_VERSION,
        "agentVersion": AGENT_VERSION,
        "uptime": get_uptime(),
        "meta": {
            "ip": get_local_ip(),
            "publicIp": get_public_ip(),
            "hostname": socket.gethostname(),
            "platform": platform.machine(),
            "os": platform.platform(),
            "vend_port": VEND_SERVER_PORT,
            "services": check_services(),
            "disk": get_disk_usage(),
            "memory": get_memory_usage(),
        },
    }

    if MACHINE_LOCATION:
        payload["location"] = MACHINE_LOCATION

    # Proximity stats
    proximity = collect_proximity()
    if proximity:
        payload["proximity"] = proximity

    # Nayax status
    nayax = collect_nayax()
    if nayax:
        payload["meta"]["nayax"] = nayax

    # Inventory
    inv = collect_inventory()
    if inv:
        payload["inventory"] = inv

    # Camera snapshots (base64, every SNAPSHOT_INTERVAL)
    snaps = collect_snapshots()
    if snaps:
        payload["snapshots"] = snaps

    return payload


def send_heartbeat(payload: Dict[str, Any]) -> bool:
    """Send heartbeat to the fleet manager."""
    url = f"{FLEET_URL}{HEARTBEAT_ENDPOINT}"
    data = json.dumps(payload).encode("utf-8")

    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Content-Type": "application/json",
            "User-Agent": f"ShakaAgent/{FIRMWARE_VERSION} ({MACHINE_ID})",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            status = resp.status
            body = json.loads(resp.read().decode())
            if status == 200 and body.get("ok"):
                return True
            logger.warning(f"Fleet responded {status}: {body}")
            return False
    except urllib.error.HTTPError as e:
        logger.warning(f"Fleet HTTP error {e.code}: {e.reason}")
        return False
    except urllib.error.URLError as e:
        logger.warning(f"Fleet unreachable: {e.reason}")
        return False
    except Exception as e:
        logger.warning(f"Heartbeat send failed: {e}")
        return False


# ---------------------------------------------------------------------------
# Product sync (pull from fleet manager)
# ---------------------------------------------------------------------------
PRODUCT_IMAGES_DIR = "/home/shaka/Shaka-main/public/images/products"
PLACEHOLDER_IMAGES_FILE = "/home/shaka/Shaka-main/src/lib/placeholder-images.json"


def _save_product_image(image_id: str, data_url: str) -> bool:
    """Save a base64 data-URL image to the local product images folder and register in placeholder-images.json."""
    try:
        import base64 as b64mod

        # data:image/webp;base64,AAAA...
        if not data_url.startswith("data:image/"):
            return False
        header, encoded = data_url.split(",", 1)
        # Determine extension from mime
        mime = header.split(":")[1].split(";")[0]  # e.g. image/webp
        ext_map = {"image/webp": ".webp", "image/png": ".png", "image/jpeg": ".jpg", "image/jpg": ".jpg", "image/gif": ".gif"}
        ext = ext_map.get(mime, ".webp")

        os.makedirs(PRODUCT_IMAGES_DIR, exist_ok=True)
        filename = f"{image_id}{ext}"
        filepath = os.path.join(PRODUCT_IMAGES_DIR, filename)
        with open(filepath, "wb") as f:
            f.write(b64mod.b64decode(encoded))
        logger.info(f"Saved product image: {filepath} ({len(encoded)//1024}KB)")

        # Register in placeholder-images.json so the agent UI can find it
        _register_placeholder_image(image_id, f"/images/products/{filename}")

        return True
    except Exception as e:
        logger.warning(f"Failed to save image for {image_id}: {e}")
        return False


def _register_placeholder_image(image_id: str, image_url: str):
    """Add or update an entry in placeholder-images.json for the agent UI."""
    try:
        data = {"placeholderImages": []}
        if os.path.exists(PLACEHOLDER_IMAGES_FILE):
            with open(PLACEHOLDER_IMAGES_FILE, "r") as f:
                data = json.load(f)

        images = data.get("placeholderImages", [])
        # Update existing or add new
        found = False
        for img in images:
            if img.get("id") == image_id:
                img["imageUrl"] = image_url
                found = True
                break
        if not found:
            images.append({
                "id": image_id,
                "description": image_id,
                "imageUrl": image_url,
                "imageHint": "product"
            })

        data["placeholderImages"] = images
        with open(PLACEHOLDER_IMAGES_FILE, "w") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        logger.debug(f"Registered placeholder image: {image_id} -> {image_url}")
    except Exception as e:
        logger.warning(f"Failed to register placeholder image for {image_id}: {e}")


def check_pending_sync():
    """Check fleet manager for pending product sync and apply locally."""
    url = f"{FLEET_URL}/api/machines/{MACHINE_ID}/sync-products"
    try:
        req = urllib.request.Request(url, headers={"User-Agent": f"ShakaAgent/{FIRMWARE_VERSION}"})
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode())

        if not data.get("pending"):
            return

        products = data.get("products", [])
        logger.info(f"Pending sync received: {len(products)} products (queued at {data.get('queuedAt', '?')})")

        # Save images from base64 and strip _imageBase64 before sending to local UI
        images_saved = 0
        clean_products = []
        for p in products:
            img_b64 = p.pop("_imageBase64", None)
            if img_b64 and p.get("imageId"):
                if _save_product_image(p["imageId"], img_b64):
                    images_saved += 1
            clean_products.append(p)

        if images_saved:
            logger.info(f"Saved {images_saved} product images to {PRODUCT_IMAGES_DIR}")

        # Push to local Shaka UI
        local_url = "http://127.0.0.1:3000/api/local-products"
        payload = json.dumps({"products": clean_products}).encode("utf-8")
        local_req = urllib.request.Request(
            local_url,
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(local_req, timeout=10) as local_resp:
            result = json.loads(local_resp.read().decode())
            logger.info(f"Local sync applied: {result}")

    except Exception as e:
        logger.debug(f"Sync check: {e}")


# ---------------------------------------------------------------------------
# WebSocket transport
# ---------------------------------------------------------------------------
_ws = None  # websocket.WebSocketApp instance or None
_ws_connected = False
_ws_thread = None

try:
    import websocket as _websocket_mod
    HAS_WEBSOCKET = True
except ImportError:
    HAS_WEBSOCKET = False
    logger.warning("websocket-client not installed – WebSocket transport disabled (pip3 install websocket-client)")


def _build_ws_url() -> str:
    """Convert FLEET_URL (https://...) to wss://... /ws"""
    url = FLEET_URL.rstrip("/")
    if url.startswith("https://"):
        return url.replace("https://", "wss://", 1) + "/ws"
    elif url.startswith("http://"):
        return url.replace("http://", "ws://", 1) + "/ws"
    return f"wss://{url}/ws"


def _apply_sync_products(products: list):
    """Apply a sync-products message received via WebSocket."""
    logger.info(f"[ws] Received sync-products: {len(products)} products")

    # Save images
    images_saved = 0
    clean_products = []
    for p in products:
        img_b64 = p.pop("_imageBase64", None)
        if img_b64 and p.get("imageId"):
            if _save_product_image(p["imageId"], img_b64):
                images_saved += 1
        clean_products.append(p)

    if images_saved:
        logger.info(f"[ws] Saved {images_saved} product images")

    # Push to local Shaka UI
    try:
        local_url = "http://127.0.0.1:3000/api/local-products"
        payload = json.dumps({"products": clean_products}).encode("utf-8")
        local_req = urllib.request.Request(
            local_url, data=payload,
            headers={"Content-Type": "application/json"}, method="POST",
        )
        with urllib.request.urlopen(local_req, timeout=10) as resp:
            result = json.loads(resp.read().decode())
            logger.info(f"[ws] Local sync applied: {result}")
    except Exception as e:
        logger.warning(f"[ws] Failed to apply sync locally: {e}")


def _ws_on_message(ws_app, raw):
    global _ws_connected
    try:
        msg = json.loads(raw)
        msg_type = msg.get("type", "")

        if msg_type == "auth-ok":
            _ws_connected = True
            logger.info(f"[ws] Authenticated as {msg.get('machineId')}")

        elif msg_type == "heartbeat-ack":
            pass  # silent ack

        elif msg_type == "sync-products":
            products = msg.get("products", [])
            _apply_sync_products(products)
            # Send ack
            try:
                ws_app.send(json.dumps({"type": "sync-ack", "status": "ok", "count": len(products)}))
            except Exception:
                pass

        elif msg_type == "error":
            logger.warning(f"[ws] Server error: {msg.get('error')}")

        else:
            logger.debug(f"[ws] Unknown message type: {msg_type}")

    except Exception as e:
        logger.warning(f"[ws] Bad message: {e}")


def _ws_on_open(ws_app):
    logger.info("[ws] Connection opened, authenticating...")
    ws_app.send(json.dumps({"type": "auth", "machineId": MACHINE_ID}))


def _ws_on_close(ws_app, close_status_code, close_msg):
    global _ws_connected
    _ws_connected = False
    logger.info(f"[ws] Connection closed (code={close_status_code})")


def _ws_on_error(ws_app, error):
    global _ws_connected
    _ws_connected = False
    logger.debug(f"[ws] Error: {error}")


def _start_ws_connection():
    """Start WebSocket connection in a background thread."""
    global _ws, _ws_thread, _ws_connected
    import threading

    ws_url = _build_ws_url()
    logger.info(f"[ws] Connecting to {ws_url}")

    _ws = _websocket_mod.WebSocketApp(
        ws_url,
        on_open=_ws_on_open,
        on_message=_ws_on_message,
        on_close=_ws_on_close,
        on_error=_ws_on_error,
    )

    _ws_thread = threading.Thread(
        target=_ws.run_forever,
        kwargs={"ping_interval": 25, "ping_timeout": 10, "reconnect": 5},
        daemon=True,
    )
    _ws_thread.start()


def _send_heartbeat_ws(payload: Dict[str, Any]) -> bool:
    """Send heartbeat via WebSocket. Returns True if sent."""
    global _ws, _ws_connected
    if not _ws or not _ws_connected:
        return False
    try:
        _ws.send(json.dumps({"type": "heartbeat", "data": payload}))
        return True
    except Exception as e:
        logger.debug(f"[ws] Send failed: {e}")
        _ws_connected = False
        return False


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------
def signal_handler(signum, frame):
    global _running
    logger.info(f"Received signal {signum}, shutting down...")
    _running = False


def main():
    global _running

    signal.signal(signal.SIGTERM, signal_handler)
    signal.signal(signal.SIGINT, signal_handler)

    logger.info("Shaka Heartbeat Service starting")
    logger.info(f"  Machine ID : {MACHINE_ID}")
    logger.info(f"  Fleet URL  : {FLEET_URL}")
    logger.info(f"  Interval   : {HEARTBEAT_INTERVAL}s")
    logger.info(f"  Vend port  : {VEND_SERVER_PORT}")
    logger.info(f"  WebSocket  : {'enabled' if HAS_WEBSOCKET else 'disabled'}")

    # Start WebSocket connection if available
    if HAS_WEBSOCKET:
        try:
            _start_ws_connection()
        except Exception as e:
            logger.warning(f"[ws] Failed to start: {e}")

    consecutive_failures = 0
    send_count = 0

    while _running:
        try:
            payload = build_payload()

            # Try WebSocket first, fall back to HTTP
            ws_ok = _send_heartbeat_ws(payload)
            if ws_ok:
                send_count += 1
                if consecutive_failures > 0:
                    logger.info(f"Heartbeat restored (via WS) after {consecutive_failures} failures")
                consecutive_failures = 0
                if send_count == 1 or send_count % 10 == 0:
                    prox = payload.get("proximity", {})
                    logger.info(f"Heartbeat #{send_count} sent via WS: {MACHINE_ID} status={payload['status']} presence={prox.get('presence_today', 0)}")
                # No need to check pending sync – WS delivers instantly
            else:
                # HTTP fallback
                success = send_heartbeat(payload)
                if success:
                    send_count += 1
                    if consecutive_failures > 0:
                        logger.info(f"Heartbeat restored (via HTTP) after {consecutive_failures} failures")
                    consecutive_failures = 0
                    if send_count == 1 or send_count % 10 == 0:
                        prox = payload.get("proximity", {})
                        logger.info(f"Heartbeat #{send_count} sent via HTTP: {MACHINE_ID} status={payload['status']} presence={prox.get('presence_today', 0)}")

                    # Check for pending product sync (HTTP polling fallback)
                    try:
                        check_pending_sync()
                    except Exception as e:
                        logger.debug(f"Sync check error: {e}")
                else:
                    consecutive_failures += 1
                    if consecutive_failures == 1 or consecutive_failures % 10 == 0:
                        logger.warning(f"Heartbeat failed ({consecutive_failures} consecutive, WS={'connected' if _ws_connected else 'disconnected'})")

        except Exception as e:
            consecutive_failures += 1
            logger.error(f"Heartbeat error: {e}")

        # Sleep in small increments so we can respond to signals quickly
        for _ in range(HEARTBEAT_INTERVAL * 2):
            if not _running:
                break
            time.sleep(0.5)

    # Cleanup
    if _ws:
        try:
            _ws.close()
        except Exception:
            pass

    logger.info("Shaka Heartbeat Service stopped")


if __name__ == "__main__":
    main()
