#!/usr/bin/env python3
"""
Nayax Spark Protocol - Python wrapper
======================================
Server-to-server API communication with Nayax payment terminals.
Replaces the Marshall RS232 serial protocol with HTTPS REST calls.

Protocol: Spark (server-to-server HTTPS)
Auth: SHA-256 signature (IntegratorId + TransactionSignature headers)
Docs: https://developerhub.nayax.com/docs/spark

Supports two flows:
  - Device Start: Consumer taps card on VPOS → Nayax calls our webhook
  - Remote Start: Our server tells Nayax to activate terminal

Webhooks received on Fleet Manager:
  - StartSession: Nayax notifies us a session has started
  - InfoQuery: Nayax asks for product/tariff info
  - TransactionNotify: Payment authorized (or denied)
  - TimeoutCallback: Session timed out
  - StopCallback: Session stopped by card tap
  - DeclineCallback: Transaction declined after TriggerTransaction
"""
from __future__ import annotations

import enum
import hashlib
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

logger = logging.getLogger("nayax_spark")

# ---------------------------------------------------------------------------
# Configuration (from environment)
# ---------------------------------------------------------------------------
# Spark API base URL (sandbox vs production)
SPARK_API_URL = os.getenv("NAYAX_SPARK_API_URL", "https://api.nayax.com")

# Credentials provided by Nayax during onboarding
SPARK_SIGN_KEY = os.getenv("NAYAX_SPARK_SIGN_KEY", "")          # 16-char shared secret
SPARK_SIGN_KEY_ID = os.getenv("NAYAX_SPARK_SIGN_KEY_ID", "")    # IntegratorId
SPARK_TOKEN_ID = os.getenv("NAYAX_SPARK_TOKEN_ID", "")          # TokenId for auth
SPARK_TERMINAL_ID = os.getenv("NAYAX_SPARK_TERMINAL_ID", "")    # VPOS terminal ID

# Webhook URL where Nayax sends callbacks (must be publicly accessible)
SPARK_WEBHOOK_URL = os.getenv("NAYAX_SPARK_WEBHOOK_URL", "https://fleet.shakadistribution.ca/api/nayax/webhook")

# Simulation mode
SIMULATION = os.getenv("NAYAX_SIMULATION", "1") == "1"

# Decimal places for price (Canada=2)
DECIMAL_PLACES = int(os.getenv("NAYAX_DECIMAL_PLACES", "2"))

# State file (shared with vend server)
STATE_FILE = os.getenv("NAYAX_STATE_FILE", "/tmp/shaka_nayax_state.json")

# Timeouts
VEND_RESULT_TIMEOUT = int(os.getenv("NAYAX_VEND_RESULT_TIMEOUT", "30"))
API_TIMEOUT = int(os.getenv("NAYAX_API_TIMEOUT", "15"))


# ---------------------------------------------------------------------------
# Data models
# ---------------------------------------------------------------------------
class NayaxState(str, enum.Enum):
    DISCONNECTED = "disconnected"
    IDLE = "idle"
    WAITING_SELECTION = "waiting_selection"
    WAITING_PAYMENT = "waiting_payment"
    AUTHORIZING = "authorizing"
    VEND_APPROVED = "vend_approved"
    DISPENSING = "dispensing"
    SETTLING = "settling"
    SESSION_COMPLETE = "session_complete"
    ERROR = "error"


class PaymentResult(str, enum.Enum):
    PENDING = "pending"
    APPROVED = "approved"
    DENIED = "denied"
    TIMEOUT = "timeout"
    ERROR = "error"
    CANCELLED = "cancelled"


@dataclass
class VendItem:
    """Single product in a vend session."""
    code: int          # product code / slot number
    price: int         # price in smallest unit (cents)
    unit: int = 1      # unit type (1 = piece)
    qty: int = 1       # quantity

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class VendSession:
    """A vending session with one or more items."""
    session_id: str = ""
    spark_transaction_id: str = ""  # Spark-specific: unique per API call
    items: List[VendItem] = field(default_factory=list)
    total_price: int = 0
    state: str = NayaxState.IDLE.value
    payment_result: str = PaymentResult.PENDING.value
    transaction_id: Optional[str] = None
    card_last4: Optional[str] = None
    error: Optional[str] = None
    created_at: float = 0.0
    updated_at: float = 0.0

    def __post_init__(self):
        if not self.session_id:
            self.session_id = f"sess-{int(time.time()*1000)}"
        if not self.spark_transaction_id:
            self.spark_transaction_id = uuid.uuid4().hex
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
            "spark_transaction_id": self.spark_transaction_id,
            "items": [i.to_dict() for i in self.items],
            "total_price": self.total_price,
            "total_display": f"{self.total_price / (10 ** DECIMAL_PLACES):.{DECIMAL_PLACES}f}",
            "state": self.state,
            "payment_result": self.payment_result,
            "transaction_id": self.transaction_id,
            "card_last4": self.card_last4,
            "error": self.error,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }


# ---------------------------------------------------------------------------
# Spark Authentication helpers
# ---------------------------------------------------------------------------
def _generate_transaction_signature(spark_transaction_id: str) -> str:
    """
    Generate TransactionSignature header value.
    SHA-256( SparkTransactionId + ";" + SignKey )
    """
    raw = f"{spark_transaction_id};{SPARK_SIGN_KEY}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _spark_headers(spark_transaction_id: str) -> Dict[str, str]:
    """Build required Spark API headers."""
    return {
        "Content-Type": "application/json",
        "IntegratorId": SPARK_SIGN_KEY_ID,
        "TransactionSignature": _generate_transaction_signature(spark_transaction_id),
    }


# ---------------------------------------------------------------------------
# Spark API client
# ---------------------------------------------------------------------------
def _spark_request(endpoint: str, payload: Dict[str, Any],
                   spark_transaction_id: Optional[str] = None) -> Dict[str, Any]:
    """
    Make an authenticated request to the Nayax Spark API.
    Returns the parsed JSON response.
    """
    if not spark_transaction_id:
        spark_transaction_id = uuid.uuid4().hex

    url = f"{SPARK_API_URL}/{endpoint.lstrip('/')}"
    headers = _spark_headers(spark_transaction_id)

    # Ensure SparkTransactionId is in the payload
    payload["SparkTransactionId"] = spark_transaction_id

    body = json.dumps(payload).encode("utf-8")

    logger.info(f"[SPARK] POST {url}")
    logger.debug(f"[SPARK] Payload: {json.dumps(payload, indent=2)}")

    try:
        req = Request(url, data=body, headers=headers, method="POST")
        with urlopen(req, timeout=API_TIMEOUT) as resp:
            resp_body = resp.read().decode("utf-8")
            result = json.loads(resp_body) if resp_body else {}
            logger.info(f"[SPARK] Response {resp.status}: {json.dumps(result)[:200]}")
            return result
    except HTTPError as e:
        error_body = ""
        try:
            error_body = e.read().decode("utf-8")
        except Exception:
            pass
        logger.error(f"[SPARK] HTTP {e.code}: {error_body[:500]}")
        raise RuntimeError(f"Spark API error {e.code}: {error_body[:200]}")
    except URLError as e:
        logger.error(f"[SPARK] Network error: {e.reason}")
        raise RuntimeError(f"Spark network error: {e.reason}")


# ---------------------------------------------------------------------------
# Spark Protocol Handler
# ---------------------------------------------------------------------------
class SparkProtocol:
    """
    Handles communication with Nayax VPOS Touch via the Spark server-to-server API.

    In LIVE mode, API calls go to Nayax servers and webhooks are received
    on the Fleet Manager at /api/nayax/webhook.

    In SIMULATION mode, all API calls are mocked and transactions
    are auto-approved after a configurable delay.
    """

    def __init__(self, simulation: bool = SIMULATION):
        self.simulation = simulation
        self._connected = False
        self._state = NayaxState.DISCONNECTED
        self._current_session: Optional[VendSession] = None
        self._lock = threading.Lock()
        self._callbacks: Dict[str, List[Callable]] = {
            "on_state_change": [],
            "on_vend_approved": [],
            "on_vend_denied": [],
            "on_transaction_info": [],
            "on_session_complete": [],
            "on_error": [],
        }
        # Simulation config
        self._sim_approval_delay = float(os.getenv("NAYAX_SIM_APPROVAL_DELAY", "3.0"))
        self._sim_auto_approve = os.getenv("NAYAX_SIM_AUTO_APPROVE", "1") == "1"

        # API stats
        self._api_calls = 0
        self._api_errors = 0

    # -- Connection ---------------------------------------------------------
    def connect(self) -> bool:
        """Initialize connection (verify credentials / enter simulation)."""
        if self.simulation:
            logger.info("[SPARK-SIM] Simulation mode - no real API calls")
            self._connected = True
            self._set_state(NayaxState.IDLE)
            return True

        # Verify we have required credentials
        if not SPARK_SIGN_KEY or not SPARK_SIGN_KEY_ID:
            logger.error("[SPARK] Missing NAYAX_SPARK_SIGN_KEY or NAYAX_SPARK_SIGN_KEY_ID")
            self._set_state(NayaxState.ERROR)
            return False

        if not SPARK_TERMINAL_ID:
            logger.error("[SPARK] Missing NAYAX_SPARK_TERMINAL_ID")
            self._set_state(NayaxState.ERROR)
            return False

        # Try StartAuthentication to verify credentials
        try:
            txn_id = uuid.uuid4().hex
            result = _spark_request("StartAuthentication", {
                "TokenId": int(SPARK_TOKEN_ID) if SPARK_TOKEN_ID else 0,
                "TerminalId": SPARK_TERMINAL_ID,
                "TerminalIdType": 1,
                "Random": uuid.uuid4().hex[:16],
                "Cipher": "",  # Will be provided by Nayax during onboarding
            }, spark_transaction_id=txn_id)

            self._connected = True
            self._set_state(NayaxState.IDLE)
            logger.info("[SPARK] Authentication successful - connected to Nayax")
            return True

        except Exception as e:
            logger.error(f"[SPARK] Authentication failed: {e}")
            # Still mark as connected in case it's a transient error
            # The actual payment calls will fail if auth is truly broken
            self._connected = True
            self._set_state(NayaxState.IDLE)
            logger.warning("[SPARK] Proceeding despite auth error - will retry on payment")
            return True

    def disconnect(self):
        """Disconnect / cleanup."""
        self._connected = False
        self._set_state(NayaxState.DISCONNECTED)
        logger.info("[SPARK] Disconnected")

    @property
    def connected(self) -> bool:
        return self._connected

    @property
    def state(self) -> NayaxState:
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
                logger.error(f"[SPARK] Callback error ({event}): {e}")

    # -- State management ---------------------------------------------------
    def _set_state(self, new_state: NayaxState):
        old = self._state
        self._state = new_state
        if self._current_session:
            self._current_session.state = new_state.value
            self._current_session.updated_at = time.time()
        self._persist_state()
        if old != new_state:
            logger.info(f"[SPARK] State: {old.value} -> {new_state.value}")
            self._emit("on_state_change", old, new_state)

    def _persist_state(self):
        """Write current state to JSON file for other processes to read."""
        try:
            data = {
                "connected": self._connected,
                "simulation": self.simulation,
                "protocol": "spark",
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
            logger.error(f"[SPARK] Failed to persist state: {e}")

    # -- Vending flow -------------------------------------------------------
    def vend_request(self, items: List[VendItem]) -> VendSession:
        """
        Start a vend session via Spark API.

        For Device Start flow (consumer taps card first):
          - Session is created when webhook StartSession arrives
          - This method is called after to set the items/price

        For Remote Start flow (server initiates):
          - Calls TriggerTransaction to activate the terminal
          - Consumer then taps card
          - TransactionNotify webhook confirms authorization
        """
        if not self._connected:
            raise RuntimeError("Not connected to Nayax")

        if self._state not in (NayaxState.IDLE, NayaxState.SESSION_COMPLETE):
            raise RuntimeError(f"Cannot start vend in state: {self._state.value}")

        session = VendSession(items=items)
        self._current_session = session
        self._set_state(NayaxState.WAITING_PAYMENT)

        logger.info(f"[SPARK] Vend request: {len(items)} items, total={session.total_price}")

        if self.simulation:
            t = threading.Thread(target=self._sim_authorize, args=(session,), daemon=True)
            t.start()
        else:
            # Remote Start: call TriggerTransaction
            self._trigger_transaction(session)

        return session

    def vend_success(self, session: Optional[VendSession] = None):
        """Report dispensing success → call Settlement."""
        session = session or self._current_session
        if not session:
            raise RuntimeError("No active session")

        self._set_state(NayaxState.SETTLING)
        logger.info(f"[SPARK] Vend success for {session.session_id}")

        if self.simulation:
            time.sleep(0.5)
            session.payment_result = PaymentResult.APPROVED.value
            self._set_state(NayaxState.SESSION_COMPLETE)
            self._emit("on_session_complete", session)
            logger.info(f"[SPARK-SIM] Session complete: {session.session_id}")
        else:
            self._settle_transaction(session, success=True)

    def vend_failure(self, session: Optional[VendSession] = None):
        """Report dispensing failure → call CancelTransaction."""
        session = session or self._current_session
        if not session:
            raise RuntimeError("No active session")

        logger.info(f"[SPARK] Vend failure for {session.session_id}")

        if self.simulation:
            session.payment_result = PaymentResult.ERROR.value
            session.error = "Dispensing failed"
            self._set_state(NayaxState.SESSION_COMPLETE)
            self._emit("on_session_complete", session)
        else:
            self._cancel_transaction(session, reason="Dispensing failed")

    def cancel_session(self):
        """Cancel the current session."""
        session = self._current_session
        if session:
            if not self.simulation and session.spark_transaction_id:
                try:
                    self._cancel_transaction(session, reason="Cancelled by operator")
                except Exception as e:
                    logger.error(f"[SPARK] Cancel API error: {e}")

            session.payment_result = PaymentResult.CANCELLED.value
            session.error = "Cancelled by operator"
            self._set_state(NayaxState.SESSION_COMPLETE)
            self._emit("on_session_complete", session)
            logger.info(f"[SPARK] Session cancelled: {session.session_id}")

    def reset(self):
        """Reset to idle state."""
        self._current_session = None
        self._set_state(NayaxState.IDLE)

    def get_state_snapshot(self) -> Dict[str, Any]:
        """Get current state as dict (for API responses)."""
        return {
            "connected": self._connected,
            "simulation": self.simulation,
            "protocol": "spark",
            "state": self._state.value,
            "session": self._current_session.to_dict() if self._current_session else None,
            "api_stats": {
                "calls": self._api_calls,
                "errors": self._api_errors,
            },
        }

    # -- Webhook handling (called by Fleet Manager) -------------------------
    def handle_webhook(self, event_type: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        """
        Process an incoming webhook from Nayax.
        Called by the Fleet Manager webhook endpoint, which forwards to RPi.

        Events:
          - StartSession: New session initiated at device
          - InfoQuery: Nayax asks for product info
          - TransactionNotify: Payment authorized/denied
          - TimeoutCallback: Session timed out
          - StopCallback: Session stopped
          - DeclineCallback: Transaction declined
        """
        logger.info(f"[SPARK] Webhook received: {event_type}")
        logger.debug(f"[SPARK] Webhook payload: {json.dumps(payload)[:500]}")

        if event_type == "StartSession":
            return self._handle_start_session(payload)
        elif event_type == "InfoQuery":
            return self._handle_info_query(payload)
        elif event_type == "TransactionNotify":
            return self._handle_transaction_notify(payload)
        elif event_type == "TimeoutCallback":
            return self._handle_timeout(payload)
        elif event_type == "StopCallback":
            return self._handle_stop(payload)
        elif event_type == "DeclineCallback":
            return self._handle_decline(payload)
        else:
            logger.warning(f"[SPARK] Unknown webhook event: {event_type}")
            return {"ResultCode": 0, "ResultDescription": "OK"}

    def _handle_start_session(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Handle StartSession webhook - a consumer started a session at the device."""
        spark_txn_id = payload.get("SparkTransactionId", "")
        terminal_id = payload.get("TerminalId", "")

        logger.info(f"[SPARK] StartSession: terminal={terminal_id} txn={spark_txn_id}")

        # Create a new session if we don't have one
        if not self._current_session or self._state in (NayaxState.IDLE, NayaxState.SESSION_COMPLETE):
            session = VendSession(spark_transaction_id=spark_txn_id)
            self._current_session = session
            self._set_state(NayaxState.WAITING_SELECTION)
        else:
            # Update existing session with Spark transaction ID
            self._current_session.spark_transaction_id = spark_txn_id

        return {
            "ResultCode": 0,
            "ResultDescription": "OK",
            "SparkTransactionId": spark_txn_id,
        }

    def _handle_info_query(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Handle InfoQuery webhook - Nayax asks for product/tariff info."""
        spark_txn_id = payload.get("SparkTransactionId", "")

        # Return product info / pricing
        session = self._current_session
        if session and session.items:
            total_display = f"{session.total_price / (10 ** DECIMAL_PLACES):.{DECIMAL_PLACES}f}"
            return {
                "ResultCode": 0,
                "ResultDescription": "OK",
                "SparkTransactionId": spark_txn_id,
                "Price": session.total_price,
                "PriceDisplay": total_display,
                "Currency": "CAD",
            }

        return {
            "ResultCode": 0,
            "ResultDescription": "OK",
            "SparkTransactionId": spark_txn_id,
        }

    def _handle_transaction_notify(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Handle TransactionNotify webhook - payment authorized or denied."""
        spark_txn_id = payload.get("SparkTransactionId", "")
        result_code = payload.get("ResultCode", -1)
        txn_id = payload.get("TransactionId", "")
        amount = payload.get("Amount", 0)
        card_last4 = payload.get("CardNumber", "")[-4:] if payload.get("CardNumber") else ""

        session = self._current_session

        if result_code == 0:
            # Payment approved
            logger.info(f"[SPARK] Payment APPROVED: txn={txn_id} amount={amount}")
            if session:
                session.transaction_id = str(txn_id)
                session.card_last4 = card_last4
                session.payment_result = PaymentResult.APPROVED.value
                self._set_state(NayaxState.VEND_APPROVED)
                self._emit("on_transaction_info", session)
                self._emit("on_vend_approved", session)
        else:
            # Payment denied
            desc = payload.get("ResultDescription", "Payment denied")
            logger.warning(f"[SPARK] Payment DENIED: code={result_code} desc={desc}")
            if session:
                session.payment_result = PaymentResult.DENIED.value
                session.error = desc
                self._set_state(NayaxState.ERROR)
                self._emit("on_vend_denied", session)

        return {
            "ResultCode": 0,
            "ResultDescription": "OK",
            "SparkTransactionId": spark_txn_id,
        }

    def _handle_timeout(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Handle TimeoutCallback - session timed out."""
        spark_txn_id = payload.get("SparkTransactionId", "")
        logger.warning(f"[SPARK] Session timeout: txn={spark_txn_id}")

        if self._current_session:
            self._current_session.payment_result = PaymentResult.TIMEOUT.value
            self._current_session.error = "Session timed out"
            self._set_state(NayaxState.SESSION_COMPLETE)
            self._emit("on_session_complete", self._current_session)

        return {"ResultCode": 0, "ResultDescription": "OK", "SparkTransactionId": spark_txn_id}

    def _handle_stop(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Handle StopCallback - session stopped by card tap."""
        spark_txn_id = payload.get("SparkTransactionId", "")
        logger.info(f"[SPARK] Session stopped: txn={spark_txn_id}")

        if self._current_session:
            self._current_session.payment_result = PaymentResult.CANCELLED.value
            self._current_session.error = "Stopped by device"
            self._set_state(NayaxState.SESSION_COMPLETE)
            self._emit("on_session_complete", self._current_session)

        return {"ResultCode": 0, "ResultDescription": "OK", "SparkTransactionId": spark_txn_id}

    def _handle_decline(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Handle DeclineCallback - transaction declined after TriggerTransaction."""
        spark_txn_id = payload.get("SparkTransactionId", "")
        reason = payload.get("ResultDescription", "Transaction declined")
        logger.warning(f"[SPARK] Transaction declined: {reason}")

        if self._current_session:
            self._current_session.payment_result = PaymentResult.DENIED.value
            self._current_session.error = reason
            self._set_state(NayaxState.ERROR)
            self._emit("on_vend_denied", self._current_session)

        return {"ResultCode": 0, "ResultDescription": "OK", "SparkTransactionId": spark_txn_id}

    # -- Spark API calls (outbound) -----------------------------------------
    def _trigger_transaction(self, session: VendSession):
        """Call TriggerTransaction to initiate a Remote Start payment."""
        self._api_calls += 1
        try:
            total_display = f"{session.total_price / (10 ** DECIMAL_PLACES):.{DECIMAL_PLACES}f}"
            result = _spark_request("TriggerTransaction", {
                "TokenId": int(SPARK_TOKEN_ID) if SPARK_TOKEN_ID else 0,
                "TerminalId": SPARK_TERMINAL_ID,
                "TerminalIdType": 1,
                "Amount": session.total_price,
                "Currency": "CAD",
                "TransactionType": 1,  # Sale
            }, spark_transaction_id=session.spark_transaction_id)

            result_code = result.get("ResultCode", -1)
            if result_code == 0:
                logger.info(f"[SPARK] TriggerTransaction accepted - waiting for card tap")
                self._set_state(NayaxState.WAITING_PAYMENT)
            else:
                desc = result.get("ResultDescription", "Unknown error")
                logger.error(f"[SPARK] TriggerTransaction failed: {desc}")
                session.error = desc
                self._set_state(NayaxState.ERROR)
                self._emit("on_error", desc)

        except Exception as e:
            self._api_errors += 1
            logger.error(f"[SPARK] TriggerTransaction error: {e}")
            session.error = str(e)
            self._set_state(NayaxState.ERROR)
            self._emit("on_error", str(e))

    def _settle_transaction(self, session: VendSession, success: bool = True):
        """Call Settlement to finalize the transaction."""
        self._api_calls += 1
        try:
            result = _spark_request("Settlement", {
                "TokenId": int(SPARK_TOKEN_ID) if SPARK_TOKEN_ID else 0,
                "TerminalId": SPARK_TERMINAL_ID,
                "TerminalIdType": 1,
                "Amount": session.total_price,
                "Currency": "CAD",
            }, spark_transaction_id=session.spark_transaction_id)

            result_code = result.get("ResultCode", -1)
            if result_code == 0:
                logger.info(f"[SPARK] Settlement successful")
                session.payment_result = PaymentResult.APPROVED.value
                self._set_state(NayaxState.SESSION_COMPLETE)
                self._emit("on_session_complete", session)
            else:
                desc = result.get("ResultDescription", "Settlement failed")
                logger.error(f"[SPARK] Settlement failed: {desc}")
                session.error = desc
                self._set_state(NayaxState.ERROR)

        except Exception as e:
            self._api_errors += 1
            logger.error(f"[SPARK] Settlement error: {e}")
            # Still mark as complete - the payment was authorized
            session.payment_result = PaymentResult.APPROVED.value
            session.error = f"Settlement API error: {e}"
            self._set_state(NayaxState.SESSION_COMPLETE)
            self._emit("on_session_complete", session)

    def _cancel_transaction(self, session: VendSession, reason: str = ""):
        """Call CancelTransaction to cancel the session."""
        self._api_calls += 1
        try:
            result = _spark_request("CancelTransaction", {
                "TokenId": int(SPARK_TOKEN_ID) if SPARK_TOKEN_ID else 0,
                "TerminalId": SPARK_TERMINAL_ID,
                "TerminalIdType": 1,
                "Reason": reason,
            }, spark_transaction_id=session.spark_transaction_id)

            session.payment_result = PaymentResult.CANCELLED.value
            session.error = reason
            self._set_state(NayaxState.SESSION_COMPLETE)
            self._emit("on_session_complete", session)
            logger.info(f"[SPARK] Transaction cancelled: {reason}")

        except Exception as e:
            self._api_errors += 1
            logger.error(f"[SPARK] CancelTransaction error: {e}")
            session.payment_result = PaymentResult.CANCELLED.value
            session.error = reason
            self._set_state(NayaxState.SESSION_COMPLETE)
            self._emit("on_session_complete", session)

    # -- Simulation ---------------------------------------------------------
    def _sim_authorize(self, session: VendSession):
        """Simulate Spark authorization flow."""
        logger.info(f"[SPARK-SIM] Waiting {self._sim_approval_delay}s for card tap...")
        self._set_state(NayaxState.AUTHORIZING)
        time.sleep(self._sim_approval_delay)

        if self._sim_auto_approve:
            session.transaction_id = f"SIM-{int(time.time())}-{session.session_id[-4:]}"
            session.card_last4 = "4242"
            self._emit("on_transaction_info", session)

            self._set_state(NayaxState.VEND_APPROVED)
            session.payment_result = PaymentResult.APPROVED.value
            self._emit("on_vend_approved", session)
            logger.info(f"[SPARK-SIM] Vend APPROVED - txn={session.transaction_id}")
        else:
            session.payment_result = PaymentResult.DENIED.value
            session.error = "Simulated denial"
            self._set_state(NayaxState.ERROR)
            self._emit("on_vend_denied", session)
            logger.info("[SPARK-SIM] Vend DENIED (sim_auto_approve=0)")


# ---------------------------------------------------------------------------
# Singleton instance
# ---------------------------------------------------------------------------
_instance: Optional[SparkProtocol] = None
_instance_lock = threading.Lock()


def get_nayax() -> SparkProtocol:
    """Get or create the singleton SparkProtocol instance."""
    global _instance
    with _instance_lock:
        if _instance is None:
            _instance = SparkProtocol()
        return _instance
