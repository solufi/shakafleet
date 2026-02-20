#!/usr/bin/env python3
"""
Shaka Payment Service
======================
Daemon that maintains the connection to the Stripe Terminal
WisePOS E reader via the Fleet Manager (server-driven integration).

Runs as systemd service: shaka-payment.service
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

from stripe_terminal import StripeTerminal, TerminalState, get_terminal

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("shaka-payment")

RECONNECT_INTERVAL = int(os.getenv("STRIPE_RECONNECT_INTERVAL", "5"))
HEARTBEAT_INTERVAL = int(os.getenv("STRIPE_HEARTBEAT_INTERVAL", "10"))

_running = True


def on_state_change(old_state, new_state):
    logger.info(f"State changed: {old_state.value} -> {new_state.value}")


def on_payment_authorized(session):
    logger.info(f"Payment AUTHORIZED: session={session.session_id} pi={session.payment_intent_id}")


def on_payment_denied(session):
    logger.warning(f"Payment DENIED: session={session.session_id} error={session.error}")


def on_payment_captured(session):
    logger.info(f"Payment CAPTURED: session={session.session_id} amount={session.captured_amount}¢")


def on_session_complete(session):
    logger.info(f"Session complete: {session.session_id} result={session.payment_result}")


def on_error(error):
    logger.error(f"Payment error: {error}")


def signal_handler(signum, frame):
    global _running
    logger.info(f"Received signal {signum}, shutting down...")
    _running = False


def main():
    global _running

    signal.signal(signal.SIGTERM, signal_handler)
    signal.signal(signal.SIGINT, signal_handler)

    terminal = get_terminal()

    # Register callbacks
    terminal.on("on_state_change", on_state_change)
    terminal.on("on_payment_authorized", on_payment_authorized)
    terminal.on("on_payment_denied", on_payment_denied)
    terminal.on("on_payment_captured", on_payment_captured)
    terminal.on("on_session_complete", on_session_complete)
    terminal.on("on_error", on_error)

    logger.info(f"Payment service starting (simulation={terminal.simulation})")
    logger.info(f"Reader ID: {terminal.reader_id}")

    # Connection loop
    while _running:
        if not terminal.connected:
            logger.info("Attempting to connect to Stripe Terminal reader...")
            if terminal.connect():
                logger.info("Connected successfully")
            else:
                logger.warning(f"Connection failed, retrying in {RECONNECT_INTERVAL}s")
                time.sleep(RECONNECT_INTERVAL)
                continue

        # Heartbeat / keep-alive loop
        try:
            time.sleep(HEARTBEAT_INTERVAL)
            terminal._persist_state()
        except Exception as e:
            logger.error(f"Heartbeat error: {e}")

    # Cleanup
    terminal.disconnect()
    logger.info("Payment service stopped")


if __name__ == "__main__":
    main()
