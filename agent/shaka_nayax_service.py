#!/usr/bin/env python3
"""
Shaka Nayax Service
====================
Daemon that maintains the connection to the Nayax VPOS Touch
and exposes state via JSON file + optional HTTP status endpoint.

Runs as systemd service: shaka-nayax.service
"""
from __future__ import annotations

import json
import logging
import os
import signal
import sys
import time

# Add parent dir to path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from nayax_marshall import MarshallProtocol, NayaxState, get_nayax

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("shaka-nayax")

RECONNECT_INTERVAL = int(os.getenv("NAYAX_RECONNECT_INTERVAL", "5"))
HEARTBEAT_INTERVAL = int(os.getenv("NAYAX_HEARTBEAT_INTERVAL", "10"))

_running = True


def on_state_change(old_state, new_state):
    logger.info(f"State changed: {old_state.value} -> {new_state.value}")


def on_vend_approved(session):
    logger.info(f"Vend APPROVED: session={session.session_id} txn={session.transaction_id}")


def on_vend_denied(session):
    logger.warning(f"Vend DENIED: session={session.session_id} error={session.error}")


def on_session_complete(session):
    logger.info(f"Session complete: {session.session_id} result={session.payment_result}")


def on_error(error):
    logger.error(f"Nayax error: {error}")


def signal_handler(signum, frame):
    global _running
    logger.info(f"Received signal {signum}, shutting down...")
    _running = False


def main():
    global _running

    signal.signal(signal.SIGTERM, signal_handler)
    signal.signal(signal.SIGINT, signal_handler)

    nayax = get_nayax()

    # Register callbacks
    nayax.on("on_state_change", on_state_change)
    nayax.on("on_vend_approved", on_vend_approved)
    nayax.on("on_vend_denied", on_vend_denied)
    nayax.on("on_session_complete", on_session_complete)
    nayax.on("on_error", on_error)

    logger.info(f"Nayax service starting (simulation={nayax.simulation})")
    logger.info(f"Serial port: {nayax.port} @ {nayax.baud}")

    # Connection loop
    while _running:
        if not nayax.connected:
            logger.info("Attempting to connect to Nayax device...")
            if nayax.connect():
                logger.info("Connected successfully")
            else:
                logger.warning(f"Connection failed, retrying in {RECONNECT_INTERVAL}s")
                time.sleep(RECONNECT_INTERVAL)
                continue

        # Heartbeat / keep-alive loop
        try:
            time.sleep(HEARTBEAT_INTERVAL)
            nayax._persist_state()
        except Exception as e:
            logger.error(f"Heartbeat error: {e}")

    # Cleanup
    nayax.disconnect()
    logger.info("Nayax service stopped")


if __name__ == "__main__":
    main()
