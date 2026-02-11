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
from typing import Any, Dict, Optional

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
    """Collect proximity summary for heartbeat."""
    summary = _local_get("/proximity/summary")
    if summary and summary.get("ok"):
        summary.pop("ok", None)
        return summary
    return None


def collect_nayax() -> Optional[Dict[str, Any]]:
    """Collect Nayax status."""
    status = _local_get("/nayax/status")
    if status and status.get("ok"):
        return {
            "connected": status.get("connected", False),
            "simulation": status.get("simulation", True),
            "state": status.get("state", "unknown"),
        }
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
        "uptime": get_uptime(),
        "meta": {
            "ip": get_local_ip(),
            "hostname": socket.gethostname(),
            "platform": platform.machine(),
            "os": platform.platform(),
            "vend_port": VEND_SERVER_PORT,
            "services": check_services(),
            "disk": get_disk_usage(),
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

    consecutive_failures = 0
    send_count = 0

    while _running:
        try:
            payload = build_payload()
            success = send_heartbeat(payload)

            if success:
                send_count += 1
                if consecutive_failures > 0:
                    logger.info(f"Heartbeat restored after {consecutive_failures} failures")
                consecutive_failures = 0
                if send_count == 1 or send_count % 10 == 0:
                    prox = payload.get("proximity", {})
                    logger.info(f"Heartbeat #{send_count} sent: {MACHINE_ID} status={payload['status']} presence={prox.get('presence_today', 0)} engagement={prox.get('engagement_today', 0)}")
            else:
                consecutive_failures += 1
                if consecutive_failures == 1 or consecutive_failures % 10 == 0:
                    logger.warning(f"Heartbeat failed ({consecutive_failures} consecutive)")

        except Exception as e:
            consecutive_failures += 1
            logger.error(f"Heartbeat error: {e}")

        # Sleep in small increments so we can respond to signals quickly
        for _ in range(HEARTBEAT_INTERVAL * 2):
            if not _running:
                break
            time.sleep(0.5)

    logger.info("Shaka Heartbeat Service stopped")


if __name__ == "__main__":
    main()
