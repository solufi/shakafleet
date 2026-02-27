#!/usr/bin/env python3
"""
Stripe Terminal – Python agent module
======================================
Server-driven integration with Stripe Terminal (WisePOS E reader).
The reader connects via Ethernet/WiFi directly to Stripe.
Payment flow is controlled via Stripe API directly from the RPi agent.

Architecture:
  RPi agent  →  Stripe API  →  WisePOS E reader (Ethernet)
  RPi agent  ←  Fleet Manager  ←  Stripe webhooks (terminal.reader.action_*)

The agent calls Stripe API directly for:
  - Creating PaymentIntents
  - Processing payments on the reader
  - Capturing / cancelling payments
  - Incremental authorizations (multi-vend)
  - Reader status checks

Webhooks still go through Fleet Manager (Stripe needs a public URL),
which forwards them to the RPi's /stripe/webhook endpoint.

Supports:
  - Pre-authorization (capture_method=manual)
  - Multi-vend via incremental authorizations
  - Interac (Canadian debit) via interac_present
"""
from __future__ import annotations

import base64
import enum
import json
import logging
import os
import threading
import time
import uuid
from dataclasses import asdict, dataclass, field
from typing import Any, Callable, Dict, List, Optional
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode

logger = logging.getLogger("stripe_terminal")

# ---------------------------------------------------------------------------
# Configuration (from environment)
# ---------------------------------------------------------------------------
# Stripe API
STRIPE_API_URL = "https://api.stripe.com/v1"
STRIPE_SECRET_KEY = os.getenv("STRIPE_SECRET_KEY", "")

# Reader ID assigned by Stripe (e.g. tmr_xxx)
STRIPE_READER_ID = os.getenv("STRIPE_READER_ID", "")

# Machine ID for this RPi
MACHINE_ID = os.getenv("MACHINE_ID", "default")

# Simulation mode
SIMULATION = os.getenv("STRIPE_SIMULATION", "1") == "1"

# Decimal places for price (Canada=2)
DECIMAL_PLACES = int(os.getenv("STRIPE_DECIMAL_PLACES", "2"))

# State file (shared with vend server)
STATE_FILE = os.getenv("STRIPE_STATE_FILE", "/tmp/shaka_stripe_state.json")

# Timeouts
VEND_RESULT_TIMEOUT = int(os.getenv("STRIPE_VEND_RESULT_TIMEOUT", "30"))
API_TIMEOUT = int(os.getenv("STRIPE_API_TIMEOUT", "15"))

# Pre-auth max amount in cents (for multi-vend, authorize up to this amount)
PREAUTH_MAX_AMOUNT = int(os.getenv("STRIPE_PREAUTH_MAX_AMOUNT", "5000"))  # $50.00


# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------
class TerminalState(str, enum.Enum):
    DISCONNECTED = "disconnected"
    IDLE = "idle"
    CREATING_INTENT = "creating_intent"
    WAITING_PAYMENT = "waiting_payment"
    AUTHORIZING = "authorizing"
    PAYMENT_AUTHORIZED = "payment_authorized"
    DISPENSING = "dispensing"
    CAPTURING = "capturing"
    SESSION_COMPLETE = "session_complete"
    ERROR = "error"


class PaymentResult(str, enum.Enum):
    PENDING = "pending"
    AUTHORIZED = "authorized"
    CAPTURED = "captured"
    DENIED = "denied"
    TIMEOUT = "timeout"
    ERROR = "error"
    CANCELLED = "cancelled"


@dataclass
class VendItem:
    """Single product in a vend session."""
    code: int          # product code / slot number
    price: int         # price in smallest unit (cents)
    name: str = ""     # product name (shown on reader display)
    unit: int = 1      # unit type (1 = piece)
    qty: int = 1       # quantity

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class VendSession:
    """A vending session with one or more items (multi-vend support)."""
    session_id: str = ""
    payment_intent_id: str = ""       # Stripe PaymentIntent ID (pi_xxx)
    items: List[VendItem] = field(default_factory=list)
    total_price: int = 0              # current authorized total in cents
    captured_amount: int = 0          # amount actually captured
    state: str = TerminalState.IDLE.value
    payment_result: str = PaymentResult.PENDING.value
    transaction_id: Optional[str] = None   # Stripe charge ID (ch_xxx)
    card_last4: Optional[str] = None
    card_brand: Optional[str] = None
    is_interac: bool = False
    incremental_supported: bool = False
    error: Optional[str] = None
    created_at: float = 0.0
    updated_at: float = 0.0

    def __post_init__(self):
        if not self.session_id:
            self.session_id = f"sess-{int(time.time() * 1000)}"
        if not self.created_at:
            self.created_at = time.time()
        self.updated_at = time.time()
        self._compute_total()

    def _compute_total(self):
        self.total_price = sum(item.price * item.qty for item in self.items)

    def add_item(self, item: VendItem):
        self.items.append(item)
        self._compute_total()
        self.updated_at = time.time()

    def to_dict(self) -> Dict[str, Any]:
        return {
            "session_id": self.session_id,
            "payment_intent_id": self.payment_intent_id,
            "items": [i.to_dict() for i in self.items],
            "total_price": self.total_price,
            "total_display": f"{self.total_price / (10 ** DECIMAL_PLACES):.{DECIMAL_PLACES}f}",
            "captured_amount": self.captured_amount,
            "state": self.state,
            "payment_result": self.payment_result,
            "transaction_id": self.transaction_id,
            "card_last4": self.card_last4,
            "card_brand": self.card_brand,
            "is_interac": self.is_interac,
            "incremental_supported": self.incremental_supported,
            "error": self.error,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }


# ---------------------------------------------------------------------------
# Stripe API helpers (direct calls from agent)
# ---------------------------------------------------------------------------
def _stripe_auth_header() -> str:
    """Build HTTP Basic auth header for Stripe API."""
    token = base64.b64encode(f"{STRIPE_SECRET_KEY}:".encode()).decode()
    return f"Basic {token}"


def _stripe_post(endpoint: str, params: Dict[str, str]) -> Dict[str, Any]:
    """
    POST to Stripe API with form-encoded params.
    Stripe uses application/x-www-form-urlencoded, not JSON.
    """
    url = f"{STRIPE_API_URL}/{endpoint.lstrip('/')}"
    body = urlencode(params).encode("utf-8")

    logger.info(f"[STRIPE] POST {url}")
    logger.debug(f"[STRIPE] Params: {params}")

    try:
        req = Request(url, data=body, headers={
            "Authorization": _stripe_auth_header(),
            "Content-Type": "application/x-www-form-urlencoded",
        }, method="POST")
        with urlopen(req, timeout=API_TIMEOUT) as resp:
            resp_body = resp.read().decode("utf-8")
            result = json.loads(resp_body) if resp_body else {}
            logger.info(f"[STRIPE] Response {resp.status}: {json.dumps(result)[:200]}")
            return result
    except HTTPError as e:
        error_body = ""
        try:
            error_body = e.read().decode("utf-8")
        except Exception:
            pass
        logger.error(f"[STRIPE] HTTP {e.code}: {error_body[:500]}")
        error_msg = ""
        try:
            error_msg = json.loads(error_body).get("error", {}).get("message", error_body[:200])
        except Exception:
            error_msg = error_body[:200]
        raise RuntimeError(f"Stripe API error {e.code}: {error_msg}")
    except URLError as e:
        logger.error(f"[STRIPE] Network error: {e.reason}")
        raise RuntimeError(f"Stripe network error: {e.reason}")


def _stripe_get(endpoint: str) -> Dict[str, Any]:
    """GET from Stripe API."""
    url = f"{STRIPE_API_URL}/{endpoint.lstrip('/')}"
    logger.info(f"[STRIPE] GET {url}")

    try:
        req = Request(url, headers={
            "Authorization": _stripe_auth_header(),
        }, method="GET")
        with urlopen(req, timeout=API_TIMEOUT) as resp:
            resp_body = resp.read().decode("utf-8")
            result = json.loads(resp_body) if resp_body else {}
            return result
    except HTTPError as e:
        error_body = ""
        try:
            error_body = e.read().decode("utf-8")
        except Exception:
            pass
        logger.error(f"[STRIPE] GET HTTP {e.code}: {error_body[:500]}")
        raise RuntimeError(f"Stripe API error {e.code}: {error_body[:200]}")
    except URLError as e:
        logger.error(f"[STRIPE] GET Network error: {e.reason}")
        raise RuntimeError(f"Stripe network error: {e.reason}")


# ---------------------------------------------------------------------------
# Stripe Terminal Protocol Handler
# ---------------------------------------------------------------------------
class StripeTerminal:
    """
    Manages payment sessions with Stripe Terminal.

    In LIVE mode, the agent calls Stripe API directly → WisePOS E reader.
    Webhooks are received via Fleet Manager → RPi /stripe/webhook.
    In SIMULATION mode, transactions are auto-approved after a delay.
    """

    def __init__(self, simulation: bool = SIMULATION):
        self.simulation = simulation
        self.reader_id = STRIPE_READER_ID
        self.machine_id = MACHINE_ID
        self._connected = False
        self._state = TerminalState.DISCONNECTED
        self._current_session: Optional[VendSession] = None
        self._lock = threading.Lock()
        self._callbacks: Dict[str, List[Callable]] = {
            "on_state_change": [],
            "on_payment_authorized": [],
            "on_payment_denied": [],
            "on_payment_captured": [],
            "on_session_complete": [],
            "on_error": [],
        }
        # Simulation config
        self._sim_approval_delay = float(os.getenv("STRIPE_SIM_APPROVAL_DELAY", "3.0"))
        self._sim_auto_approve = os.getenv("STRIPE_SIM_AUTO_APPROVE", "1") == "1"

        # API stats
        self._api_calls = 0
        self._api_errors = 0

    # -- Connection ---------------------------------------------------------
    def connect(self) -> bool:
        """Initialize connection (verify reader is online via Stripe API)."""
        if self.simulation:
            logger.info("[STRIPE-SIM] Simulation mode - no real API calls")
            self._connected = True
            self._set_state(TerminalState.IDLE)
            return True

        if not STRIPE_SECRET_KEY:
            logger.error("[STRIPE] Missing STRIPE_SECRET_KEY")
            self._set_state(TerminalState.ERROR)
            return False

        if not self.reader_id:
            logger.error("[STRIPE] Missing STRIPE_READER_ID")
            self._set_state(TerminalState.ERROR)
            return False

        # Check reader status directly via Stripe API
        try:
            result = _stripe_get(f"terminal/readers/{self.reader_id}")
            status = result.get("status", "offline")
            device_type = result.get("device_type", "unknown")
            label = result.get("label", "")
            if status == "online":
                self._connected = True
                self._set_state(TerminalState.IDLE)
                logger.info(f"[STRIPE] Reader {self.reader_id} ({device_type}) is online - {label}")
                return True
            else:
                logger.warning(f"[STRIPE] Reader {self.reader_id} is {status}")
                self._connected = True
                self._set_state(TerminalState.IDLE)
                return True
        except Exception as e:
            logger.error(f"[STRIPE] Reader check failed: {e}")
            self._connected = True
            self._set_state(TerminalState.IDLE)
            return True

    def disconnect(self):
        """Disconnect / cleanup."""
        self._connected = False
        self._set_state(TerminalState.DISCONNECTED)
        logger.info("[STRIPE] Disconnected")

    @property
    def connected(self) -> bool:
        return self._connected

    @property
    def state(self) -> TerminalState:
        return self._state

    @property
    def current_session(self) -> Optional[VendSession]:
        return self._current_session

    # -- Callbacks ----------------------------------------------------------
    def on(self, event: str, callback: Callable):
        """Register a callback for an event."""
        if event in self._callbacks:
            self._callbacks[event].append(callback)

    def _emit(self, event: str, *args, **kwargs):
        for cb in self._callbacks.get(event, []):
            try:
                cb(*args, **kwargs)
            except Exception as e:
                logger.error(f"[STRIPE] Callback error ({event}): {e}")

    # -- State management ---------------------------------------------------
    def _set_state(self, new_state: TerminalState):
        old = self._state
        self._state = new_state
        if self._current_session:
            self._current_session.state = new_state.value
            self._current_session.updated_at = time.time()
        self._persist_state()
        if old != new_state:
            logger.info(f"[STRIPE] State: {old.value} -> {new_state.value}")
            self._emit("on_state_change", old, new_state)

    def _persist_state(self):
        """Write current state to JSON file for other processes to read."""
        try:
            data = {
                "connected": self._connected,
                "simulation": self.simulation,
                "protocol": "stripe_terminal",
                "reader_id": self.reader_id,
                "state": self._state.value,
                "session": self._current_session.to_dict() if self._current_session else None,
                "timestamp": time.time(),
                "api_stats": {
                    "calls": self._api_calls,
                    "errors": self._api_errors,
                },
            }
            with open(STATE_FILE, "w") as f:
                json.dump(data, f, indent=2)
        except Exception as e:
            logger.error(f"[STRIPE] Failed to persist state: {e}")

    # -- Payment flow -------------------------------------------------------
    def start_payment(self, items: List[VendItem]) -> VendSession:
        """
        Start a payment session.

        Flow:
          1. Create PaymentIntent (capture_method=manual for pre-auth)
          2. Process payment on reader (customer taps card)
          3. Wait for webhook confirmation
          4. On success → dispense → capture
          5. On failure → cancel PaymentIntent

        For multi-vend:
          - request_incremental_authorization_support=true
          - After first dispense, can add items and increment authorization
        """
        if not self._connected:
            raise RuntimeError("Not connected")

        if self._state not in (TerminalState.IDLE, TerminalState.SESSION_COMPLETE):
            raise RuntimeError(f"Cannot start payment in state: {self._state.value}")

        session = VendSession(items=items)
        self._current_session = session
        self._set_state(TerminalState.CREATING_INTENT)

        logger.info(f"[STRIPE] Payment request: {len(items)} items, total={session.total_price}¢")

        if self.simulation:
            t = threading.Thread(target=self._sim_authorize, args=(session,), daemon=True)
            t.start()
        else:
            self._create_and_process_payment(session)

        return session

    def add_item_to_session(self, item: VendItem) -> VendSession:
        """
        Add an item to the current session (multi-vend).
        Increments the authorization if supported.
        """
        session = self._current_session
        if not session:
            raise RuntimeError("No active session")

        if self._state != TerminalState.PAYMENT_AUTHORIZED:
            raise RuntimeError(f"Cannot add item in state: {self._state.value}")

        old_total = session.total_price
        session.add_item(item)
        new_total = session.total_price

        logger.info(f"[STRIPE] Adding item: code={item.code} price={item.price}¢ "
                     f"new_total={new_total}¢")

        if not self.simulation and session.incremental_supported:
            # Increment authorization via Fleet Manager
            self._increment_authorization(session, new_total)
        elif not self.simulation and not session.incremental_supported:
            # Interac or unsupported card - can't increment
            # Check if new total exceeds original auth
            if new_total > old_total:
                logger.warning("[STRIPE] Incremental auth not supported - "
                               "new total exceeds authorized amount")
                session.error = "Cannot add items: card does not support incremental authorization"
                # Revert the item
                session.items.pop()
                session._compute_total()
                raise RuntimeError(session.error)

        return session

    def vend_success(self, session: Optional[VendSession] = None):
        """Report dispensing success → capture the payment."""
        session = session or self._current_session
        if not session:
            raise RuntimeError("No active session")

        self._set_state(TerminalState.CAPTURING)
        logger.info(f"[STRIPE] Vend success for {session.session_id}")

        if self.simulation:
            time.sleep(0.5)
            session.captured_amount = session.total_price
            session.payment_result = PaymentResult.CAPTURED.value
            self._set_state(TerminalState.SESSION_COMPLETE)
            self._emit("on_payment_captured", session)
            self._emit("on_session_complete", session)
            logger.info(f"[STRIPE-SIM] Payment captured: {session.total_price}¢")
        elif session.is_interac:
            # Interac payments are captured automatically on tap — no manual capture needed
            session.captured_amount = session.total_price
            session.payment_result = PaymentResult.CAPTURED.value
            self._set_state(TerminalState.SESSION_COMPLETE)
            self._emit("on_payment_captured", session)
            self._emit("on_session_complete", session)
            logger.info(f"[STRIPE] Interac payment already captured: {session.total_price}¢")
        else:
            self._capture_payment(session)

    def vend_failure(self, session: Optional[VendSession] = None):
        """Report dispensing failure → cancel the PaymentIntent."""
        session = session or self._current_session
        if not session:
            raise RuntimeError("No active session")

        logger.info(f"[STRIPE] Vend failure for {session.session_id}")

        if self.simulation:
            session.payment_result = PaymentResult.CANCELLED.value
            session.error = "Dispensing failed"
            self._set_state(TerminalState.SESSION_COMPLETE)
            self._emit("on_session_complete", session)
        elif session.is_interac:
            # Interac is already captured — cannot cancel, would need a refund
            logger.warning("[STRIPE] Interac payment already captured — refund needed for failure")
            session.payment_result = PaymentResult.CAPTURED.value
            session.error = "Dispensing failed (Interac auto-captured — refund required)"
            self._set_state(TerminalState.SESSION_COMPLETE)
            self._emit("on_session_complete", session)
        else:
            self._cancel_payment(session, reason="Dispensing failed")

    def cancel_session(self):
        """Cancel the current session."""
        session = self._current_session
        if session:
            if not self.simulation and session.payment_intent_id:
                try:
                    self._cancel_payment(session, reason="Cancelled by operator")
                except Exception as e:
                    logger.error(f"[STRIPE] Cancel error: {e}")

            session.payment_result = PaymentResult.CANCELLED.value
            session.error = "Cancelled by operator"
            self._set_state(TerminalState.SESSION_COMPLETE)
            self._emit("on_session_complete", session)
            logger.info(f"[STRIPE] Session cancelled: {session.session_id}")

    def reset(self):
        """Reset to idle state."""
        self._current_session = None
        self._set_state(TerminalState.IDLE)

    def get_state_snapshot(self) -> Dict[str, Any]:
        """Get current state as dict (for API responses)."""
        return {
            "connected": self._connected,
            "simulation": self.simulation,
            "protocol": "stripe_terminal",
            "reader_id": self.reader_id,
            "state": self._state.value,
            "session": self._current_session.to_dict() if self._current_session else None,
            "api_stats": {
                "calls": self._api_calls,
                "errors": self._api_errors,
            },
        }

    # -- Webhook handling (called by Fleet Manager → RPi) -------------------
    def handle_webhook(self, event_type: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        """
        Process an incoming Stripe webhook forwarded from Fleet Manager.

        Events:
          - terminal.reader.action_succeeded: Payment processed successfully
          - terminal.reader.action_failed: Payment failed
          - terminal.reader.action_updated: Reader action status update
          - payment_intent.amount_capturable_updated: Auth amount changed
        """
        logger.info(f"[STRIPE] Webhook received: {event_type}")
        logger.debug(f"[STRIPE] Webhook payload: {json.dumps(payload)[:500]}")

        if event_type == "terminal.reader.action_succeeded":
            return self._handle_action_succeeded(payload)
        elif event_type == "terminal.reader.action_failed":
            return self._handle_action_failed(payload)
        elif event_type == "terminal.reader.action_updated":
            return self._handle_action_updated(payload)
        elif event_type == "payment_intent.amount_capturable_updated":
            return self._handle_amount_updated(payload)
        elif event_type == "payment_intent.canceled":
            return self._handle_payment_cancelled(payload)
        else:
            logger.warning(f"[STRIPE] Unknown webhook event: {event_type}")
            return {"ok": True}

    def _handle_action_succeeded(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Reader action succeeded (payment collected)."""
        reader_data = payload.get("data", {}).get("object", {})
        action = reader_data.get("action", {})
        action_type = action.get("type", "")

        if action_type == "process_payment_intent":
            pi = action.get("process_payment_intent", {}).get("payment_intent", "")
            logger.info(f"[STRIPE] Payment collected: pi={pi}")

            session = self._current_session
            if session:
                session.payment_intent_id = pi if isinstance(pi, str) else session.payment_intent_id

                # Extract card details from the payment method
                pm_details = action.get("process_payment_intent", {}).get("payment_method_details", {})
                card_present = pm_details.get("card_present", {})
                interac = pm_details.get("interac_present", {})

                if interac:
                    session.is_interac = True
                    session.card_last4 = interac.get("last4", "")
                    session.card_brand = "interac"
                    session.incremental_supported = False
                elif card_present:
                    session.card_last4 = card_present.get("last4", "")
                    session.card_brand = card_present.get("brand", "")
                    # Check if incremental auth is supported
                    receipt = card_present.get("receipt", {})
                    session.incremental_supported = card_present.get(
                        "incremental_authorization_supported", False
                    )

                session.payment_result = PaymentResult.AUTHORIZED.value
                self._set_state(TerminalState.PAYMENT_AUTHORIZED)
                self._emit("on_payment_authorized", session)

        return {"ok": True}

    def _handle_action_failed(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Reader action failed."""
        reader_data = payload.get("data", {}).get("object", {})
        action = reader_data.get("action", {})
        failure = action.get("failure_message", "Payment failed")
        failure_code = action.get("failure_code", "unknown")

        logger.warning(f"[STRIPE] Action failed: {failure_code} - {failure}")

        session = self._current_session
        if session:
            session.payment_result = PaymentResult.DENIED.value
            session.error = f"{failure_code}: {failure}"
            self._set_state(TerminalState.ERROR)
            self._emit("on_payment_denied", session)

        return {"ok": True}

    def _handle_action_updated(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Reader action status update (e.g. waiting for card)."""
        reader_data = payload.get("data", {}).get("object", {})
        action = reader_data.get("action", {})
        status = action.get("status", "")

        logger.info(f"[STRIPE] Action updated: status={status}")

        if status == "in_progress":
            self._set_state(TerminalState.WAITING_PAYMENT)

        return {"ok": True}

    def _handle_amount_updated(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """PaymentIntent amount capturable updated (incremental auth)."""
        pi_data = payload.get("data", {}).get("object", {})
        new_amount = pi_data.get("amount_capturable", 0)

        logger.info(f"[STRIPE] Amount capturable updated: {new_amount}¢")

        session = self._current_session
        if session:
            session.total_price = new_amount
            session.updated_at = time.time()
            self._persist_state()

        return {"ok": True}

    def _handle_payment_cancelled(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """PaymentIntent was cancelled."""
        logger.info("[STRIPE] PaymentIntent cancelled")

        session = self._current_session
        if session:
            session.payment_result = PaymentResult.CANCELLED.value
            self._set_state(TerminalState.SESSION_COMPLETE)
            self._emit("on_session_complete", session)

        return {"ok": True}

    # -- Stripe API calls (direct from agent) ---------------------------------
    def _create_and_process_payment(self, session: VendSession):
        """
        Create a PaymentIntent and process it on the reader.
        Two Stripe API calls:
          1. POST /v1/payment_intents  (create with manual capture)
          2. POST /v1/terminal/readers/{id}/process_payment_intent
        """
        self._api_calls += 1
        try:
            # Step 1: Create PaymentIntent
            # Interac (Canadian debit) does NOT support capture_method=manual.
            # We set capture_method per payment method type:
            #   - card_present: manual (allows pre-auth, multi-vend, incremental auth)
            #   - interac_present: automatic (captured immediately on tap)
            pi_params = {
                "amount": str(session.total_price),
                "currency": "cad",
                "payment_method_types[0]": "card_present",
                "payment_method_types[1]": "interac_present",
                "capture_method": "automatic",
                "metadata[machineId]": self.machine_id,
                "metadata[sessionId]": session.session_id,
                "payment_method_options[card_present][capture_method]": "manual",
                "payment_method_options[card_present][request_incremental_authorization_support]": "true",
            }
            # Add item metadata
            for i, item in enumerate(session.items):
                pi_params[f"metadata[item_{i}_code]"] = str(item.code)
                pi_params[f"metadata[item_{i}_price]"] = str(item.price)
                pi_params[f"metadata[item_{i}_name]"] = item.name

            pi = _stripe_post("payment_intents", pi_params)
            session.payment_intent_id = pi.get("id", "")
            logger.info(f"[STRIPE] PaymentIntent created: {session.payment_intent_id}")

            # Step 2: Process on reader
            self._api_calls += 1
            process_result = _stripe_post(
                f"terminal/readers/{self.reader_id}/process_payment_intent",
                {"payment_intent": session.payment_intent_id}
            )
            action_status = process_result.get("action", {}).get("status", "")
            logger.info(f"[STRIPE] Processing on reader {self.reader_id}: {action_status}")
            self._set_state(TerminalState.WAITING_PAYMENT)

            # Step 3: Poll PaymentIntent until customer taps or timeout
            self._poll_payment_intent(session)

        except Exception as e:
            self._api_errors += 1
            logger.error(f"[STRIPE] Create/process payment error: {e}")
            # Cancel the PI if it was created
            if session.payment_intent_id:
                try:
                    _stripe_post(f"payment_intents/{session.payment_intent_id}/cancel", {})
                except Exception:
                    pass
            session.error = str(e)
            self._set_state(TerminalState.ERROR)
            self._emit("on_error", str(e))

    def _poll_payment_intent(self, session: VendSession):
        """
        Poll the PaymentIntent status until the customer taps or timeout.
        This replaces webhook-based notification for payment collection.
        """
        poll_interval = 2.0  # seconds
        max_wait = VEND_RESULT_TIMEOUT  # from env, default 30s
        elapsed = 0.0

        logger.info(f"[STRIPE] Polling PI {session.payment_intent_id} "
                     f"(interval={poll_interval}s, max={max_wait}s)")

        while elapsed < max_wait:
            time.sleep(poll_interval)
            elapsed += poll_interval

            try:
                self._api_calls += 1
                pi = _stripe_get(f"payment_intents/{session.payment_intent_id}")
                status = pi.get("status", "")
                logger.info(f"[STRIPE] Poll: status={status} ({elapsed:.0f}s)")

                if status == "requires_capture":
                    # Card payment (credit/debit) authorized — needs manual capture
                    self._extract_card_details(session, pi)
                    session.payment_result = PaymentResult.AUTHORIZED.value
                    self._set_state(TerminalState.PAYMENT_AUTHORIZED)
                    self._emit("on_payment_authorized", session)
                    logger.info(f"[STRIPE] Payment authorized: {session.card_brand} "
                                f"****{session.card_last4}")
                    return

                elif status == "succeeded":
                    # Interac or auto-captured — already done
                    self._extract_card_details(session, pi)
                    session.captured_amount = pi.get("amount_received", session.total_price)
                    session.payment_result = PaymentResult.CAPTURED.value
                    session.transaction_id = pi.get("latest_charge", "")
                    self._set_state(TerminalState.SESSION_COMPLETE)
                    self._emit("on_payment_captured", session)
                    self._emit("on_session_complete", session)
                    logger.info(f"[STRIPE] Payment auto-captured (Interac): "
                                f"{session.captured_amount}¢")
                    return

                elif status == "canceled" or status == "cancelled":
                    session.payment_result = PaymentResult.CANCELLED.value
                    session.error = "Payment cancelled"
                    self._set_state(TerminalState.SESSION_COMPLETE)
                    self._emit("on_session_complete", session)
                    logger.info("[STRIPE] Payment cancelled during polling")
                    return

                elif status in ("requires_payment_method",):
                    # Payment failed (card declined, etc.)
                    last_error = pi.get("last_payment_error", {})
                    error_msg = last_error.get("message", "Payment failed")
                    session.payment_result = PaymentResult.DENIED.value
                    session.error = error_msg
                    self._set_state(TerminalState.ERROR)
                    self._emit("on_payment_denied", session)
                    logger.warning(f"[STRIPE] Payment denied: {error_msg}")
                    return

                # Still in requires_action or processing — keep polling

            except Exception as e:
                self._api_errors += 1
                logger.warning(f"[STRIPE] Poll error: {e}")
                # Don't break on transient errors, keep polling

        # Timeout — cancel the payment
        logger.warning(f"[STRIPE] Poll timeout after {max_wait}s — cancelling")
        session.error = f"Timeout: no card tap after {max_wait}s"
        self._set_state(TerminalState.ERROR)
        self._emit("on_error", session.error)
        try:
            _stripe_post(f"payment_intents/{session.payment_intent_id}/cancel", {})
        except Exception:
            pass

    def _extract_card_details(self, session: VendSession, pi: Dict[str, Any]):
        """Extract card brand, last4, and Interac flag from a PaymentIntent."""
        try:
            charges = pi.get("charges", {}).get("data", [])
            if charges:
                pm_details = charges[0].get("payment_method_details", {})
                interac = pm_details.get("interac_present", {})
                card = pm_details.get("card_present", {})

                if interac and interac.get("last4"):
                    session.is_interac = True
                    session.card_last4 = interac.get("last4", "")
                    session.card_brand = "interac"
                    session.incremental_supported = False
                elif card and card.get("last4"):
                    session.card_last4 = card.get("last4", "")
                    session.card_brand = card.get("brand", "")
                    session.incremental_supported = card.get(
                        "incremental_authorization_supported", False
                    )
        except Exception as e:
            logger.warning(f"[STRIPE] Could not extract card details: {e}")

    def _increment_authorization(self, session: VendSession, new_amount: int):
        """Increment the authorization amount for multi-vend."""
        self._api_calls += 1
        try:
            result = _stripe_post(
                f"payment_intents/{session.payment_intent_id}/increment_authorization",
                {"amount": str(new_amount)}
            )
            new_auth = result.get("amount", new_amount)
            logger.info(f"[STRIPE] Authorization incremented to {new_auth}¢")

        except Exception as e:
            self._api_errors += 1
            logger.error(f"[STRIPE] Increment error: {e}")
            # Revert the last item
            if session.items:
                session.items.pop()
                session._compute_total()
            raise RuntimeError(str(e))

    def _capture_payment(self, session: VendSession):
        """Capture the authorized payment."""
        self._api_calls += 1
        try:
            params = {"amount_to_capture": str(session.total_price)}
            result = _stripe_post(
                f"payment_intents/{session.payment_intent_id}/capture",
                params
            )

            session.captured_amount = result.get("amount_received", session.total_price)
            session.payment_result = PaymentResult.CAPTURED.value
            session.transaction_id = result.get("latest_charge", "")
            self._set_state(TerminalState.SESSION_COMPLETE)
            self._emit("on_payment_captured", session)
            self._emit("on_session_complete", session)
            logger.info(f"[STRIPE] Payment captured: {session.captured_amount}¢ "
                         f"charge={session.transaction_id}")

        except Exception as e:
            self._api_errors += 1
            logger.error(f"[STRIPE] Capture error: {e}")
            session.error = str(e)
            self._set_state(TerminalState.ERROR)
            self._emit("on_error", str(e))

    def _cancel_payment(self, session: VendSession, reason: str = ""):
        """Cancel the PaymentIntent."""
        self._api_calls += 1
        try:
            params = {"cancellation_reason": "requested_by_customer"}
            if reason:
                params["metadata[cancel_reason]"] = reason
            _stripe_post(
                f"payment_intents/{session.payment_intent_id}/cancel",
                params
            )

            session.payment_result = PaymentResult.CANCELLED.value
            session.error = reason
            self._set_state(TerminalState.SESSION_COMPLETE)
            self._emit("on_session_complete", session)
            logger.info(f"[STRIPE] Payment cancelled: {reason}")

        except Exception as e:
            self._api_errors += 1
            logger.error(f"[STRIPE] Cancel error: {e}")
            session.payment_result = PaymentResult.CANCELLED.value
            session.error = reason
            self._set_state(TerminalState.SESSION_COMPLETE)
            self._emit("on_session_complete", session)

    # -- Simulation ---------------------------------------------------------
    def _sim_authorize(self, session: VendSession):
        """Simulate payment authorization flow."""
        logger.info(f"[STRIPE-SIM] Waiting {self._sim_approval_delay}s for card tap...")
        self._set_state(TerminalState.WAITING_PAYMENT)
        time.sleep(self._sim_approval_delay / 2)
        self._set_state(TerminalState.AUTHORIZING)
        time.sleep(self._sim_approval_delay / 2)

        if self._sim_auto_approve:
            session.payment_intent_id = f"pi_sim_{int(time.time())}"
            session.transaction_id = f"ch_sim_{int(time.time())}"
            session.card_last4 = "4242"
            session.card_brand = "visa"
            session.incremental_supported = True
            session.payment_result = PaymentResult.AUTHORIZED.value

            self._set_state(TerminalState.PAYMENT_AUTHORIZED)
            self._emit("on_payment_authorized", session)
            logger.info(f"[STRIPE-SIM] Payment AUTHORIZED - pi={session.payment_intent_id}")
        else:
            session.payment_result = PaymentResult.DENIED.value
            session.error = "Simulated denial"
            self._set_state(TerminalState.ERROR)
            self._emit("on_payment_denied", session)
            logger.info("[STRIPE-SIM] Payment DENIED (sim_auto_approve=0)")


# ---------------------------------------------------------------------------
# Singleton instance
# ---------------------------------------------------------------------------
_instance: Optional[StripeTerminal] = None
_instance_lock = threading.Lock()


def get_terminal() -> StripeTerminal:
    """Get or create the singleton StripeTerminal instance."""
    global _instance
    with _instance_lock:
        if _instance is None:
            _instance = StripeTerminal()
        return _instance
