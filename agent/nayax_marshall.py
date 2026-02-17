#!/usr/bin/env python3
"""
Nayax Marshall Protocol - Python wrapper
=========================================
Communication layer for Nayax VPOS Touch via RS232 (USB adapter).
Supports Multi-Vending with Pre-Selection flow.

Protocol: Marshall over RS232
Baud: 115200 8N1 (Nayax default)
Device: /dev/ttyUSB0 (USB-RS232 adapter)

Packet format (reverse-engineered):
  LEN(1) SEQ(3) DATA(4) FLAGS(1) CRC16-LE(2) = 11 bytes
  CRC: CRC-16/XMODEM (poly=0x1021, init=0x0000) in little-endian

Nayax polls VMC every ~1s with flags=0x01, data=0xFFFFFFFF (idle).
VMC responds with matching seq, flags=0x00, data=0x00000000 (idle ACK).

Vend flow over serial:
  VMC sets response data field to encode vend commands.
  Nayax changes its poll data/flags to signal session events.
"""
from __future__ import annotations

import enum
import json
import logging
import os
import struct
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
POLL_TIMEOUT = float(os.getenv("NAYAX_POLL_TIMEOUT", "5.0"))  # seconds without poll = comm error


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
# CRC-16/XMODEM helper
# ---------------------------------------------------------------------------
def _crc16_xmodem(data: bytes) -> int:
    """Compute CRC-16/XMODEM (poly=0x1021, init=0x0000)."""
    crc = 0x0000
    for byte in data:
        crc ^= byte << 8
        for _ in range(8):
            if crc & 0x8000:
                crc = (crc << 1) ^ 0x1021
            else:
                crc <<= 1
            crc &= 0xFFFF
    return crc


def _make_packet(seq_bytes: bytes, data: bytes, flags: int) -> bytes:
    """Build an 11-byte Marshall packet: LEN(1) SEQ(3) DATA(4) FLAGS(1) CRC16-LE(2)."""
    payload = b'\x09' + seq_bytes + data + bytes([flags])
    crc = _crc16_xmodem(payload)
    return payload + struct.pack('<H', crc)


def _parse_packet(raw: bytes):
    """Parse an 11-byte packet. Returns (seq_bytes, data, flags, crc_ok) or None."""
    if len(raw) < 11 or raw[0] != 0x09:
        return None
    payload = raw[:9]
    recv_crc = struct.unpack('<H', raw[9:11])[0]
    calc_crc = _crc16_xmodem(payload)
    return raw[1:4], raw[4:8], raw[8], recv_crc == calc_crc


# ---------------------------------------------------------------------------
# Marshall Protocol Constants
# ---------------------------------------------------------------------------
# Nayax poll flags
NAYAX_FLAG_POLL       = 0x01  # Standard idle poll from Nayax
NAYAX_FLAG_SESSION    = 0x02  # Session-related event from Nayax
NAYAX_FLAG_APPROVED   = 0x03  # Vend approved
NAYAX_FLAG_DENIED     = 0x04  # Vend denied
NAYAX_FLAG_TXN_INFO   = 0x05  # Transaction info
NAYAX_FLAG_SETTLED    = 0x06  # Settlement complete
NAYAX_FLAG_CANCELLED  = 0x07  # Session cancelled by device

# VMC response flags
VMC_FLAG_ACK          = 0x00  # Idle ACK
VMC_FLAG_VEND_REQ     = 0x10  # Vend request
VMC_FLAG_VEND_OK      = 0x11  # Vend success
VMC_FLAG_VEND_FAIL    = 0x12  # Vend failure
VMC_FLAG_CANCEL       = 0x13  # Cancel session
VMC_FLAG_SESSION_DONE = 0x14  # Session complete

# Idle data patterns
NAYAX_IDLE_DATA = b'\xff\xff\xff\xff'
VMC_IDLE_DATA   = b'\x00\x00\x00\x00'


# ---------------------------------------------------------------------------
# Marshall Protocol Handler
# ---------------------------------------------------------------------------
class MarshallProtocol:
    """
    Handles communication with Nayax VPOS Touch over RS232.
    
    In LIVE mode, a background thread reads Nayax poll packets and
    responds with ACK or vend commands. The Nayax device drives the
    poll cycle (~1 packet/second).
    
    In SIMULATION mode, all serial I/O is mocked and transactions
    are auto-approved after a configurable delay.
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

        # Serial protocol state
        self._poll_thread: Optional[threading.Thread] = None
        self._poll_running = False
        self._last_poll_time = 0.0
        self._poll_count = 0
        self._resp_data = VMC_IDLE_DATA   # data field for next response
        self._resp_flags = VMC_FLAG_ACK   # flags for next response
        self._resp_lock = threading.Lock()
        self._link_ready = False
        self._comm_errors = 0
        self._crc_errors = 0

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
                timeout=0.5,
            )
            self._connected = True
            logger.info(f"[NAYAX] Serial port opened: {self.port} @ {self.baud}")

            # Start background poll responder
            self._poll_running = True
            self._poll_thread = threading.Thread(
                target=self._poll_responder_loop, daemon=True, name="nayax-poll"
            )
            self._poll_thread.start()
            logger.info("[NAYAX] Poll responder thread started")

            # Wait for first poll to confirm link
            deadline = time.time() + POLL_TIMEOUT
            while time.time() < deadline and not self._link_ready:
                time.sleep(0.1)

            if self._link_ready:
                self._set_state(NayaxState.IDLE)
                logger.info("[NAYAX] Link established - receiving polls from Nayax device")
                return True
            else:
                logger.warning("[NAYAX] No polls received within timeout - device may not be ready")
                # Still mark as connected, polls may come later
                self._set_state(NayaxState.IDLE)
                return True

        except Exception as e:
            logger.error(f"[NAYAX] Connection failed: {e}")
            self._set_state(NayaxState.ERROR)
            return False

    def disconnect(self):
        """Disconnect from the Nayax device."""
        self._poll_running = False
        if self._poll_thread:
            self._poll_thread.join(timeout=3.0)
            self._poll_thread = None
        if self._serial and not self.simulation:
            try:
                self._serial.close()
            except Exception:
                pass
        self._serial = None
        self._connected = False
        self._link_ready = False
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
            if not self.simulation:
                data["link"] = {
                    "poll_count": self._poll_count,
                    "link_ready": self._link_ready,
                    "comm_errors": self._comm_errors,
                    "crc_errors": self._crc_errors,
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
        snapshot = {
            "connected": self._connected,
            "simulation": self.simulation,
            "state": self._state.value,
            "session": self._current_session.to_dict() if self._current_session else None,
        }
        if not self.simulation:
            snapshot["link"] = self.get_link_stats()
        return snapshot

    def get_link_stats(self) -> Dict[str, Any]:
        """Get serial link statistics."""
        return {
            "poll_count": self._poll_count,
            "link_ready": self._link_ready,
            "comm_errors": self._comm_errors,
            "crc_errors": self._crc_errors,
            "last_poll_age": round(time.time() - self._last_poll_time, 1) if self._last_poll_time else None,
        }

    # -- Serial poll responder (background thread) --------------------------
    def _poll_responder_loop(self):
        """Background thread: read Nayax polls, send responses."""
        buf = b''
        logger.info("[NAYAX] Poll responder running")

        while self._poll_running:
            try:
                if not self._serial or not self._serial.is_open:
                    time.sleep(0.5)
                    continue

                # Read available bytes
                chunk = self._serial.read(64)
                if not chunk:
                    # Check for comm timeout
                    if (self._last_poll_time > 0 and
                            time.time() - self._last_poll_time > POLL_TIMEOUT):
                        if self._link_ready:
                            self._link_ready = False
                            self._comm_errors += 1
                            logger.warning("[NAYAX] Communication timeout - no polls received")
                            self._emit("on_error", "Communication timeout")
                    continue

                buf += chunk

                # Process complete 11-byte packets
                while len(buf) >= 11:
                    # Find packet start (0x09)
                    idx = buf.find(b'\x09')
                    if idx == -1:
                        buf = b''
                        break
                    if idx > 0:
                        buf = buf[idx:]
                    if len(buf) < 11:
                        break

                    raw = buf[:11]
                    buf = buf[11:]

                    parsed = _parse_packet(raw)
                    if parsed is None:
                        continue

                    seq_bytes, data, flags, crc_ok = parsed

                    if not crc_ok:
                        self._crc_errors += 1
                        logger.debug("[NAYAX] CRC error on received packet")
                        continue

                    self._last_poll_time = time.time()
                    self._poll_count += 1

                    if not self._link_ready:
                        self._link_ready = True
                        logger.info("[NAYAX] First poll received - link is UP")

                    # Process the Nayax packet
                    self._handle_nayax_packet(seq_bytes, data, flags)

                    # Build and send response
                    with self._resp_lock:
                        resp_data = self._resp_data
                        resp_flags = self._resp_flags

                    resp = _make_packet(seq_bytes, resp_data, resp_flags)
                    self._serial.write(resp)
                    self._serial.flush()

                    # After sending a non-idle response, reset to idle for next poll
                    if resp_flags != VMC_FLAG_ACK:
                        with self._resp_lock:
                            self._resp_data = VMC_IDLE_DATA
                            self._resp_flags = VMC_FLAG_ACK

            except Exception as e:
                logger.error(f"[NAYAX] Poll responder error: {e}")
                self._comm_errors += 1
                time.sleep(1.0)

        logger.info("[NAYAX] Poll responder stopped")

    def _handle_nayax_packet(self, seq_bytes: bytes, data: bytes, flags: int):
        """Process an incoming Nayax packet and update state accordingly."""
        if flags == NAYAX_FLAG_POLL and data == NAYAX_IDLE_DATA:
            # Standard idle poll - nothing to do
            return

        # Non-idle packet from Nayax
        logger.info(f"[NAYAX] RX event: flags=0x{flags:02x} data={data.hex()}")

        session = self._current_session

        if flags == NAYAX_FLAG_SESSION:
            # Session begin - Nayax detected a card or is ready
            if session and self._state == NayaxState.WAITING_PAYMENT:
                self._set_state(NayaxState.AUTHORIZING)
                logger.info("[NAYAX] Card detected - authorizing...")

        elif flags == NAYAX_FLAG_TXN_INFO:
            # Transaction info from Nayax
            if session:
                # Extract transaction data from the 4-byte data field
                txn_id = int.from_bytes(data, 'big')
                session.transaction_id = f"NX-{txn_id}"
                logger.info(f"[NAYAX] Transaction info: txn_id={session.transaction_id}")
                self._emit("on_transaction_info", session)

        elif flags == NAYAX_FLAG_APPROVED:
            # Vend approved by Nayax
            if session:
                session.payment_result = PaymentResult.APPROVED.value
                self._set_state(NayaxState.VEND_APPROVED)
                self._emit("on_vend_approved", session)
                logger.info(f"[NAYAX] Vend APPROVED: session={session.session_id}")

        elif flags == NAYAX_FLAG_DENIED:
            # Vend denied
            if session:
                session.payment_result = PaymentResult.DENIED.value
                session.error = "Payment denied by Nayax"
                self._set_state(NayaxState.ERROR)
                self._emit("on_vend_denied", session)
                logger.warning(f"[NAYAX] Vend DENIED: session={session.session_id}")

        elif flags == NAYAX_FLAG_SETTLED:
            # Settlement complete
            if session:
                self._set_state(NayaxState.SESSION_COMPLETE)
                self._emit("on_session_complete", session)
                logger.info(f"[NAYAX] Settlement complete: session={session.session_id}")

        elif flags == NAYAX_FLAG_CANCELLED:
            # Session cancelled by device
            if session:
                session.payment_result = PaymentResult.CANCELLED.value
                session.error = "Cancelled by Nayax device"
                self._set_state(NayaxState.SESSION_COMPLETE)
                self._emit("on_session_complete", session)
                logger.info(f"[NAYAX] Session cancelled by device")

        else:
            logger.debug(f"[NAYAX] Unknown flags=0x{flags:02x} data={data.hex()}")

    def _set_response(self, data: bytes, flags: int):
        """Set the data/flags for the next poll response."""
        with self._resp_lock:
            self._resp_data = data
            self._resp_flags = flags

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

    # -- Real serial vend commands ------------------------------------------
    def _send_vend_request(self, session: VendSession):
        """
        Send vend request to Nayax device via Marshall protocol.
        Encodes total price in the 4-byte data field with VEND_REQ flag.
        """
        price = min(session.total_price, 0xFFFF)
        # Data: 2 bytes price (big-endian) + 2 bytes item count
        data = struct.pack('>HH', price, len(session.items))
        self._set_response(data, VMC_FLAG_VEND_REQ)
        logger.info(f"[NAYAX] Vend request queued: price={price} items={len(session.items)}")

    def _send_vend_status(self, session: VendSession, success: bool):
        """
        Report vend result to Nayax device.
        """
        flag = VMC_FLAG_VEND_OK if success else VMC_FLAG_VEND_FAIL
        price = min(session.total_price, 0xFFFF)
        data = struct.pack('>HH', price, len(session.items))
        self._set_response(data, flag)
        logger.info(f"[NAYAX] Vend status queued: success={success}")

        if success:
            # Also queue session complete
            def _complete_after_settle():
                time.sleep(2.0)  # Wait for Nayax to settle
                self._set_response(VMC_IDLE_DATA, VMC_FLAG_SESSION_DONE)
                time.sleep(1.0)
                if self._current_session:
                    self._set_state(NayaxState.SESSION_COMPLETE)
                    self._emit("on_session_complete", self._current_session)
            threading.Thread(target=_complete_after_settle, daemon=True).start()


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
