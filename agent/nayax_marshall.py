#!/usr/bin/env python3
"""
Nayax Marshall Protocol - Python wrapper
=========================================
Communication layer for Nayax VPOS Touch via RS232 (USB adapter).
Supports Multi-Vending with Pre-Selection flow.

When the real Nayax SDK (C) is available, this module can be replaced
by a ctypes/cffi wrapper around the .so library.  Until then it runs
in SIMULATION mode so the rest of the stack can be developed and tested.

Protocol: Marshall over RS232
Baud: 115200 8N1 (Nayax default)
Device: /dev/ttyUSB0 (USB-RS232 adapter)
"""
from __future__ import annotations

import enum
import json
import logging
import os
import threading
import time
from dataclasses import asdict, dataclass, field
from typing import Any, Callable, Dict, List, Optional

logger = logging.getLogger("nayax_marshall")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
SERIAL_PORT = os.getenv("NAYAX_SERIAL_PORT", "/dev/ttyUSB0")
BAUD_RATE = int(os.getenv("NAYAX_BAUD_RATE", "115200"))
SIMULATION = os.getenv("NAYAX_SIMULATION", "1") == "1"
DECIMAL_PLACES = int(os.getenv("NAYAX_DECIMAL_PLACES", "2"))  # Canada = 2
VEND_RESULT_TIMEOUT = int(os.getenv("NAYAX_VEND_RESULT_TIMEOUT", "30"))
STATE_FILE = os.getenv("NAYAX_STATE_FILE", "/tmp/shaka_nayax_state.json")


# ---------------------------------------------------------------------------
# Data models (mirrors Nayax SDK structures)
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
    """Single product in a vend session (mirrors vmc_vend_t.vend_item_t)."""
    code: int          # product code / slot number
    price: int         # price in smallest unit (cents). Max 65535 (0xFFFF)
    unit: int = 1      # unit type (1 = piece)
    qty: int = 1       # quantity

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class VendSession:
    """A vending session with one or more items (multi-vend)."""
    session_id: str = ""
    items: List[VendItem] = field(default_factory=list)
    total_price: int = 0  # computed
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
# Marshall Protocol Handler
# ---------------------------------------------------------------------------
class MarshallProtocol:
    """
    Handles communication with Nayax VPOS Touch over RS232.
    
    In SIMULATION mode, all serial I/O is mocked and transactions
    are auto-approved after a configurable delay.
    
    When the real SDK arrives:
      - Replace _serial_connect / _serial_send / _serial_recv
      - Or use ctypes to call the C SDK .so directly
    """

    def __init__(self, port: str = SERIAL_PORT, baud: int = BAUD_RATE,
                 simulation: bool = SIMULATION):
        self.port = port
        self.baud = baud
        self.simulation = simulation
        self._serial = None
        self._lock = threading.Lock()
        self._connected = False
        self._state = NayaxState.DISCONNECTED
        self._current_session: Optional[VendSession] = None
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

    # -- Connection ---------------------------------------------------------
    def connect(self) -> bool:
        """Connect to the Nayax device via RS232."""
        if self.simulation:
            logger.info("[NAYAX-SIM] Simulation mode - no real serial connection")
            self._connected = True
            self._set_state(NayaxState.IDLE)
            return True

        try:
            import serial  # pyserial
            self._serial = serial.Serial(
                port=self.port,
                baudrate=self.baud,
                bytesize=serial.EIGHTBITS,
                parity=serial.PARITY_NONE,
                stopbits=serial.STOPBITS_ONE,
                timeout=1.0,
            )
            self._connected = True
            self._set_state(NayaxState.IDLE)
            logger.info(f"[NAYAX] Connected to {self.port} @ {self.baud}")
            return True
        except Exception as e:
            logger.error(f"[NAYAX] Connection failed: {e}")
            self._set_state(NayaxState.ERROR)
            return False

    def disconnect(self):
        """Disconnect from the Nayax device."""
        if self._serial and not self.simulation:
            try:
                self._serial.close()
            except Exception:
                pass
        self._connected = False
        self._set_state(NayaxState.DISCONNECTED)
        logger.info("[NAYAX] Disconnected")

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
                logger.error(f"[NAYAX] Callback error ({event}): {e}")

    # -- State management ---------------------------------------------------
    def _set_state(self, new_state: NayaxState):
        old = self._state
        self._state = new_state
        if self._current_session:
            self._current_session.state = new_state.value
            self._current_session.updated_at = time.time()
        self._persist_state()
        if old != new_state:
            logger.info(f"[NAYAX] State: {old.value} -> {new_state.value}")
            self._emit("on_state_change", old, new_state)

    def _persist_state(self):
        """Write current state to JSON file for other processes to read."""
        try:
            data = {
                "connected": self._connected,
                "simulation": self.simulation,
                "state": self._state.value,
                "session": self._current_session.to_dict() if self._current_session else None,
                "timestamp": time.time(),
            }
            with open(STATE_FILE, "w") as f:
                json.dump(data, f, indent=2)
        except Exception as e:
            logger.error(f"[NAYAX] Failed to persist state: {e}")

    # -- Vending flow (Multi-Vend with Pre-Selection) -----------------------
    def vend_request(self, items: List[VendItem]) -> VendSession:
        """
        Start a multi-vend session.
        
        Flow:
        1. Create session with selected items
        2. Send vend request to Nayax device
        3. Device prompts "Please Present Card"
        4. Wait for authorization (async via callbacks)
        
        Returns the VendSession (check session.state for progress).
        """
        if not self._connected:
            raise RuntimeError("Not connected to Nayax device")

        if self._state not in (NayaxState.IDLE, NayaxState.SESSION_COMPLETE):
            raise RuntimeError(f"Cannot start vend in state: {self._state.value}")

        session = VendSession(items=items)
        self._current_session = session
        self._set_state(NayaxState.WAITING_PAYMENT)

        logger.info(f"[NAYAX] Vend request: {len(items)} items, total={session.total_price}")

        if self.simulation:
            # Simulate async authorization
            t = threading.Thread(target=self._sim_authorize, args=(session,), daemon=True)
            t.start()
        else:
            # Real SDK: send vend request over serial
            self._send_vend_request(session)

        return session

    def vend_success(self, session: Optional[VendSession] = None):
        """Report that dispensing was successful."""
        session = session or self._current_session
        if not session:
            raise RuntimeError("No active session")

        self._set_state(NayaxState.SETTLING)
        logger.info(f"[NAYAX] Vend success reported for {session.session_id}")

        if self.simulation:
            # Simulate settlement
            time.sleep(0.5)
            session.payment_result = PaymentResult.APPROVED.value
            self._set_state(NayaxState.SESSION_COMPLETE)
            self._emit("on_session_complete", session)
            logger.info(f"[NAYAX-SIM] Session complete: {session.session_id}")
        else:
            self._send_vend_status(session, success=True)

    def vend_failure(self, session: Optional[VendSession] = None):
        """Report that dispensing failed."""
        session = session or self._current_session
        if not session:
            raise RuntimeError("No active session")

        logger.info(f"[NAYAX] Vend failure reported for {session.session_id}")

        if self.simulation:
            session.payment_result = PaymentResult.ERROR.value
            session.error = "Dispensing failed"
            self._set_state(NayaxState.SESSION_COMPLETE)
            self._emit("on_session_complete", session)
        else:
            self._send_vend_status(session, success=False)

    def cancel_session(self):
        """Cancel the current session."""
        if self._current_session:
            self._current_session.payment_result = PaymentResult.CANCELLED.value
            self._current_session.error = "Cancelled by operator"
            self._set_state(NayaxState.SESSION_COMPLETE)
            self._emit("on_session_complete", self._current_session)
            logger.info(f"[NAYAX] Session cancelled: {self._current_session.session_id}")

    def reset(self):
        """Reset to idle state."""
        self._current_session = None
        self._set_state(NayaxState.IDLE)

    def get_state_snapshot(self) -> Dict[str, Any]:
        """Get current state as dict (for API responses)."""
        return {
            "connected": self._connected,
            "simulation": self.simulation,
            "state": self._state.value,
            "session": self._current_session.to_dict() if self._current_session else None,
        }

    # -- Simulation ---------------------------------------------------------
    def _sim_authorize(self, session: VendSession):
        """Simulate Nayax authorization flow."""
        logger.info(f"[NAYAX-SIM] Waiting {self._sim_approval_delay}s for card tap...")
        self._set_state(NayaxState.AUTHORIZING)
        time.sleep(self._sim_approval_delay)

        if self._sim_auto_approve:
            # Simulate transaction info
            session.transaction_id = f"SIM-{int(time.time())}-{session.session_id[-4:]}"
            session.card_last4 = "4242"
            self._emit("on_transaction_info", session)

            # Approve
            self._set_state(NayaxState.VEND_APPROVED)
            session.payment_result = PaymentResult.APPROVED.value
            self._emit("on_vend_approved", session)
            logger.info(f"[NAYAX-SIM] Vend APPROVED - txn={session.transaction_id}")
        else:
            session.payment_result = PaymentResult.DENIED.value
            session.error = "Simulated denial"
            self._set_state(NayaxState.ERROR)
            self._emit("on_vend_denied", session)
            logger.info("[NAYAX-SIM] Vend DENIED (sim_auto_approve=0)")

    # -- Real serial (placeholder for SDK integration) ----------------------
    def _send_vend_request(self, session: VendSession):
        """
        Send vend request to Nayax device via Marshall protocol.
        
        TODO: Replace with actual SDK calls when available:
          C SDK:  vmc_vend_vend_request(vend_session_t *session)
          
        The SDK handles the low-level serial framing (STX/ETX/checksum).
        """
        logger.warning("[NAYAX] _send_vend_request: NOT IMPLEMENTED - need Nayax C SDK")
        # Placeholder: when SDK .so is available, use ctypes:
        #   from ctypes import cdll, Structure, c_ushort, c_ubyte, POINTER
        #   lib = cdll.LoadLibrary("/home/shaka/nayax_sdk/libmarshall.so")
        #   ...

    def _send_vend_status(self, session: VendSession, success: bool):
        """
        Report vend result to Nayax device.
        
        TODO: Replace with actual SDK calls:
          C SDK:  vmc_vend_vend_status(&session, success ? __true : __false)
        """
        logger.warning("[NAYAX] _send_vend_status: NOT IMPLEMENTED - need Nayax C SDK")


# ---------------------------------------------------------------------------
# Singleton instance
# ---------------------------------------------------------------------------
_instance: Optional[MarshallProtocol] = None
_instance_lock = threading.Lock()


def get_nayax() -> MarshallProtocol:
    """Get or create the singleton MarshallProtocol instance."""
    global _instance
    with _instance_lock:
        if _instance is None:
            _instance = MarshallProtocol()
        return _instance
