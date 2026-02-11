#!/usr/bin/env python3
"""
Shaka Proximity Service — TeraRanger Evo Swipe Plus
=====================================================
Daemon that reads the Evo Swipe Plus sensor and exposes state via JSON file.
Supports all sensor modes: presence, swipe (gesture), engagement, bidirectional.

The sensor is connected via USB and appears as /dev/ttyACM0.
Baud rate: 115200, protocol: binary with CRC8.

State is written to /tmp/shaka_proximity_state.json for the vend server to read.
"""
from __future__ import annotations

import json
import logging
import os
import signal
import sys
import time
import threading
from typing import Any, Dict, Optional

# Add parent dir to path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from evo_swipe_plus.Evo_Swipe_Plus_py3 import Evo_Swipe_Plus
from proximity_logger import init_db, log_event

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("shaka-proximity")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
SERIAL_PORT = os.getenv("EVO_SERIAL_PORT", "/dev/ttyACM0")
STATE_FILE = os.getenv("EVO_STATE_FILE", "/tmp/shaka_proximity_state.json")
SENSOR_MODE = os.getenv("EVO_SENSOR_MODE", "presence")  # presence, swipe, bidirectional
PRESENCE_COOLDOWN = float(os.getenv("EVO_PRESENCE_COOLDOWN", "2.0"))  # seconds between presence events
CALLBACK_URL = os.getenv("EVO_CALLBACK_URL", "")  # optional: POST events to this URL

_running = True


# ---------------------------------------------------------------------------
# Proximity state
# ---------------------------------------------------------------------------
class ProximityState:
    """Thread-safe state container for the proximity sensor."""

    def __init__(self):
        self._lock = threading.Lock()
        self.connected = False
        self.mode = SENSOR_MODE
        self.presence_detected = False
        self.presence_count = 0
        self.last_presence_time = 0.0
        self.engagement_status = "none"  # none, engaged, disengaged
        self.last_gesture = "none"  # none, left, right
        self.last_gesture_time = 0.0
        self.bidirectional_inside = 0
        self.bidirectional_in = 0
        self.bidirectional_out = 0
        self.distance_mm = [0, 0]  # two ToF sensors
        self.validation_status = "none"
        self.error: Optional[str] = None
        self.last_update = 0.0
        self.events: list = []  # last N events for debugging

    def to_dict(self) -> Dict[str, Any]:
        with self._lock:
            return {
                "connected": self.connected,
                "mode": self.mode,
                "presence": {
                    "detected": self.presence_detected,
                    "count": self.presence_count,
                    "lastTime": self.last_presence_time,
                },
                "engagement": self.engagement_status,
                "gesture": {
                    "last": self.last_gesture,
                    "lastTime": self.last_gesture_time,
                },
                "bidirectional": {
                    "inside": self.bidirectional_inside,
                    "in": self.bidirectional_in,
                    "out": self.bidirectional_out,
                },
                "distance_mm": self.distance_mm,
                "validation": self.validation_status,
                "error": self.error,
                "lastUpdate": self.last_update,
                "recentEvents": self.events[-10:],  # last 10 events
            }

    def add_event(self, event_type: str, data: Any):
        with self._lock:
            self.events.append({
                "type": event_type,
                "data": data,
                "time": time.time(),
            })
            # Keep only last 50 events in memory
            if len(self.events) > 50:
                self.events = self.events[-50:]

    def persist(self):
        """Write state to JSON file."""
        try:
            with open(STATE_FILE, "w") as f:
                json.dump(self.to_dict(), f, indent=2)
        except Exception as e:
            logger.error(f"Failed to persist state: {e}")


state = ProximityState()


# ---------------------------------------------------------------------------
# Sensor reading loop
# ---------------------------------------------------------------------------
def read_sensor_loop(sensor: Evo_Swipe_Plus):
    """Main loop: read frames from the sensor and update state."""
    global _running

    logger.info(f"Sensor loop started in {state.mode} mode")
    state.connected = True
    state.persist()

    # Initialize the SQLite database for persistent logging
    try:
        init_db()
        logger.info("Proximity event database initialized")
    except Exception as e:
        logger.error(f"Failed to init DB: {e}")

    last_persist = 0.0
    last_presence_event = 0.0

    while _running:
        try:
            header, data = sensor.get_ranges()

            now = time.time()
            state.last_update = now

            if header == b'DD':
                # Dual distance (swipe mode) — two ranges in meters
                if len(data) >= 2:
                    state.distance_mm = [
                        int(data[0] * 1000) if isinstance(data[0], (int, float)) and data[0] > 0 else 0,
                        int(data[1] * 1000) if isinstance(data[1], (int, float)) and data[1] > 0 else 0,
                    ]

            elif header == b'TT':
                # Single distance (presence mode) — one range in meters
                if len(data) >= 1:
                    dist = data[0]
                    state.distance_mm = [
                        int(dist * 1000) if isinstance(dist, (int, float)) and dist > 0 else 0,
                        0,
                    ]

            elif header == b'PC':
                # Bidirectional people count: (inside, in, out)
                if len(data) >= 3:
                    state.bidirectional_inside = data[0]
                    state.bidirectional_in = data[1]
                    state.bidirectional_out = data[2]
                    state.add_event("bidirectional", {
                        "inside": data[0], "in": data[1], "out": data[2]
                    })

            elif header == b'TS':
                # Swipe gesture: Left or Right
                if data:
                    gesture_raw = data[0]
                    if isinstance(gesture_raw, bytes):
                        gesture_raw = gesture_raw.decode("utf-8").strip()
                    gesture = gesture_raw.lower() if gesture_raw else "none"
                    if gesture in ("left", "right"):
                        state.last_gesture = gesture
                        state.last_gesture_time = now
                        state.add_event("gesture", gesture)
                        logger.info(f"Gesture: {gesture}")
                        _notify_event("gesture", gesture)
                        log_event(f"gesture_{gesture}", gesture, distance_mm=state.distance_mm[0])

            elif header == b'PP':
                # Presence status + counter
                if len(data) >= 2:
                    presence_raw = data[0]
                    if isinstance(presence_raw, bytes):
                        presence_raw = presence_raw.decode("utf-8").strip()
                    count = data[1][0] if isinstance(data[1], tuple) else data[1]

                    was_present = state.presence_detected
                    is_present = "present" in str(presence_raw).lower() or "yes" in str(presence_raw).lower()
                    state.presence_detected = is_present

                    if count > state.presence_count:
                        state.presence_count = count
                        # Cooldown to avoid spamming
                        if now - last_presence_event > PRESENCE_COOLDOWN:
                            last_presence_event = now
                            state.last_presence_time = now
                            state.add_event("presence", {"count": count, "status": str(presence_raw)})
                            logger.info(f"Presence #{count}: {presence_raw}")
                            _notify_event("presence", {"count": count})
                            log_event("presence", {"count": count, "status": str(presence_raw)}, distance_mm=state.distance_mm[0])

            elif header == b'PR':
                # Presence counter reset response
                if data:
                    count = data[0][0] if isinstance(data[0], tuple) else data[0]
                    state.presence_count = count
                    logger.info(f"Presence counter reset to {count}")

            elif header == b'EE':
                # Engagement status
                if data:
                    eng_raw = data[0]
                    if isinstance(eng_raw, bytes):
                        eng_raw = eng_raw.decode("utf-8").strip()
                    eng = str(eng_raw).lower()
                    if "engaged" in eng and "dis" not in eng:
                        state.engagement_status = "engaged"
                    elif "disengaged" in eng:
                        state.engagement_status = "disengaged"
                    else:
                        state.engagement_status = eng
                    state.add_event("engagement", state.engagement_status)
                    logger.info(f"Engagement: {state.engagement_status}")
                    _notify_event("engagement", state.engagement_status)
                    if state.engagement_status == "engaged":
                        log_event("engagement", state.engagement_status, distance_mm=state.distance_mm[0])

            elif header == b'VV':
                # Validation status
                if data:
                    val_raw = data[0]
                    if isinstance(val_raw, bytes):
                        val_raw = val_raw.decode("utf-8").strip()
                    state.validation_status = str(val_raw)
                    state.add_event("validation", state.validation_status)

            # Persist state periodically (every 0.5s max)
            if now - last_persist > 0.5:
                state.persist()
                last_persist = now

        except Exception as e:
            if _running:
                logger.error(f"Sensor read error: {e}")
                state.error = str(e)
                state.persist()
                time.sleep(1)


def _notify_event(event_type: str, data: Any):
    """Optionally POST events to a callback URL (e.g., the vend server or UI)."""
    if not CALLBACK_URL:
        return
    try:
        import urllib.request
        payload = json.dumps({"event": event_type, "data": data, "time": time.time()}).encode()
        req = urllib.request.Request(
            CALLBACK_URL,
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        urllib.request.urlopen(req, timeout=2)
    except Exception as e:
        logger.debug(f"Callback failed: {e}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def signal_handler(signum, frame):
    global _running
    logger.info(f"Received signal {signum}, shutting down...")
    _running = False


def main():
    global _running

    signal.signal(signal.SIGTERM, signal_handler)
    signal.signal(signal.SIGINT, signal_handler)

    logger.info(f"Shaka Proximity Service starting")
    logger.info(f"Serial port: {SERIAL_PORT}")
    logger.info(f"Sensor mode: {SENSOR_MODE}")
    logger.info(f"State file: {STATE_FILE}")

    # Connection retry loop
    while _running:
        try:
            logger.info(f"Connecting to Evo Swipe Plus on {SERIAL_PORT}...")
            sensor = Evo_Swipe_Plus(portname=SERIAL_PORT)

            # Set sensor mode
            if SENSOR_MODE == "swipe":
                sensor.set_swipe_mode()
                logger.info("Swipe mode activated")
            elif SENSOR_MODE == "bidirectional":
                sensor.set_bidirectional_mode()
                logger.info("Bidirectional mode activated")
            else:
                sensor.set_presence_mode()
                logger.info("Presence mode activated")

            state.mode = SENSOR_MODE
            state.connected = True
            state.error = None
            logger.info("Connected to Evo Swipe Plus")

            # Flush input buffer
            sensor.port.flushInput()

            # Start reading
            read_sensor_loop(sensor)

        except SystemExit:
            break
        except Exception as e:
            logger.error(f"Connection error: {e}")
            state.connected = False
            state.error = str(e)
            state.persist()
            if _running:
                logger.info("Retrying in 5 seconds...")
                time.sleep(5)

    # Cleanup
    state.connected = False
    state.persist()
    logger.info("Shaka Proximity Service stopped")


if __name__ == "__main__":
    main()
