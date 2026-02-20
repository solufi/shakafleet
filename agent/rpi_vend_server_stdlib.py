#!/usr/bin/env python3
from __future__ import annotations

import json
import os
import re
import subprocess
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Any, Dict, Optional, Tuple

import sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from stripe_terminal import get_terminal, VendItem, VendSession, TerminalState, PaymentResult
from proximity_logger import init_db as init_proximity_db, get_today_stats, get_daily_stats, get_weekly_stats, get_recent_events, get_summary_for_heartbeat



def location_to_sequence(location: str) -> str:
    match = re.match(r"^([A-Ha-h])([1-8])$", location.strip())
    if not match:
        raise ValueError("Invalid location format. Expected A1-H8.")

    # Legacy -> numeric row/col (A=1..H=8, 1..8 => 0..7)
    row_num = ord(match.group(1).upper()) - ord("A") + 1
    col_num = int(match.group(2)) - 1
    return f"{row_num}{col_num}"


def normalize_to_seq(value: str) -> str:
    v = (value or "").strip()
    if not v:
        raise ValueError("Missing location/sequence")

    # Numeric location 10-89
    m = re.match(r"^([1-8])([0-9])$", v)
    if m:
        return f"{m.group(1)}{m.group(2)}"

    if re.match(r"^[0-9*# _-]+$", v):
        cleaned = "".join(ch for ch in v if ch not in " _-")
        # If it's two digits (10-89) without '#', keep as-is
        # If user included '#', keep it.
        return cleaned

    return location_to_sequence(v)


def parse_drop_result(stdout: str) -> Tuple[Optional[bool], bool]:
    if "✅ DROP DETECTED" in stdout:
        return True, True
    if "❌ NO DROP" in stdout:
        return False, True
    return None, False


def run_vend(seq: str, use_relay: bool = False) -> Dict[str, Any]:
    """Execute vend command via shaka_validation2.py or relay trigger"""
    script_path = os.getenv("SHAKA_SCRIPT", "/home/shaka/shaka_validation2.py")
    python_bin = os.getenv("PYTHON_BIN", "python3")
    active_low = os.getenv("ACTIVE_LOW", "0") == "1"
    drop_gpio = os.getenv("DROP_GPIO", "17")
    drop_edge = os.getenv("DROP_EDGE", "FALLING")
    drop_timeout = os.getenv("DROP_TIMEOUT", "10")
    drop_bounce_ms = os.getenv("DROP_BOUNCE_MS", "40")
    drop_retries = os.getenv("DROP_RETRIES", "1")
    
    try:
        if use_relay:
            # Use relay mode instead of keypad sequence
            cmd = [python_bin, script_path, "--relay"]
        else:
            # Use keypad sequence mode
            cmd = [
                python_bin,
                script_path,
                "--seq",
                seq,
                "--drop-gpio",
                str(drop_gpio),
                "--drop-edge",
                str(drop_edge),
                "--drop-timeout",
                str(drop_timeout),
                "--drop-bounce-ms",
                str(drop_bounce_ms),
                "--drop-retries",
                str(drop_retries),
            ]

        if active_low:
            cmd.append("--active-low")
        
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=30
        )
        
        drop_detected, drop_parsed = parse_drop_result(result.stdout)
        
        return {
            "ok": result.returncode == 0,
            "message": "Vend completed" if result.returncode == 0 else "Vend failed",
            "sequence": seq,
            "useRelay": use_relay,
            "dropDetected": drop_detected,
            "dropParsed": drop_parsed,
            "stdout": result.stdout,
            "stderr": result.stderr,
            "returncode": result.returncode
        }
    except subprocess.TimeoutExpired:
        return {
            "ok": False,
            "message": "Vend timeout after 30s",
            "sequence": seq,
            "useRelay": use_relay,
            "dropDetected": None,
            "dropParsed": False,
            "stdout": "",
            "stderr": "Timeout",
            "returncode": -1
        }
    except Exception as e:
        return {
            "ok": False,
            "message": f"Error: {str(e)}",
            "sequence": seq,
            "useRelay": use_relay,
            "dropDetected": None,
            "dropParsed": False,
            "stdout": "",
            "stderr": str(e),
            "returncode": -2
        }


def _start_dataset_capture() -> Dict[str, Any]:
    script_path = os.getenv(
        "SHAKA_DATASET_CAPTURE_SCRIPT",
        os.path.join(os.path.dirname(__file__), "shaka_capture_dataset.py"),
    )
    camera_url = os.getenv("SHAKA_CAMERA_URL", "http://127.0.0.1:5002/camera/0")
    out_dir = os.getenv("SHAKA_DATASET_OUT_DIR", "/home/shaka/datasets")
    duration_s = float(os.getenv("SHAKA_DATASET_DURATION_S", "15"))
    interval_ms = int(os.getenv("SHAKA_DATASET_INTERVAL_MS", "250"))

    os.makedirs(out_dir, exist_ok=True)

    log_dir = os.getenv("SHAKA_DATASET_LOG_DIR", "/tmp")
    os.makedirs(log_dir, exist_ok=True)
    ts = time.strftime("%Y%m%d_%H%M%S")
    log_path = os.path.join(log_dir, f"shaka_dataset_capture_{ts}.log")

    cmd = [
        "python3",
        script_path,
        "--url",
        camera_url,
        "--out-dir",
        out_dir,
        "--duration-s",
        str(duration_s),
        "--interval-ms",
        str(interval_ms),
    ]

    try:
        with open(log_path, "a", encoding="utf-8") as logf:
            proc = subprocess.Popen(cmd, stdout=logf, stderr=logf)
        return {
            "started": True,
            "pid": proc.pid,
            "cameraUrl": camera_url,
            "outDir": out_dir,
            "logPath": log_path,
        }
    except Exception as e:
        return {
            "started": False,
            "error": str(e),
            "cameraUrl": camera_url,
            "outDir": out_dir,
            "logPath": log_path,
        }


PAYMENT_STATUS_FILE = "/tmp/shaka_payment_status.json"

def get_payment_status() -> Dict[str, Any]:
    """Get payment status from MDB sniffer file"""
    try:
        if os.path.exists(PAYMENT_STATUS_FILE):
            with open(PAYMENT_STATUS_FILE, "r") as f:
                data = json.load(f)
                status = data.get("status", "pending")
                timestamp = data.get("timestamp", 0)
                # Status is valid for 5 seconds
                if time.time() - timestamp < 5:
                    return {"ok": True, "status": status, "timestamp": timestamp}
        return {"ok": True, "status": "pending", "timestamp": 0}
    except Exception as e:
        return {"ok": False, "status": "error", "error": str(e)}


def set_payment_status(status: str) -> Dict[str, Any]:
    """Set payment status (for testing or MDB sniffer integration)"""
    try:
        data = {"status": status, "timestamp": time.time()}
        with open(PAYMENT_STATUS_FILE, "w") as f:
            json.dump(data, f)
        return {"ok": True, "status": status}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def clear_payment_status() -> Dict[str, Any]:
    """Clear payment status file"""
    try:
        if os.path.exists(PAYMENT_STATUS_FILE):
            os.remove(PAYMENT_STATUS_FILE)
        return {"ok": True}
    except Exception as e:
        return {"ok": False, "error": str(e)}



# ---------------------------------------------------------------------------
# Proximity Sensor (Evo Swipe Plus)
# ---------------------------------------------------------------------------
PROXIMITY_STATE_FILE = "/tmp/shaka_proximity_state.json"

def get_proximity_status() -> Dict[str, Any]:
    """Read proximity sensor state from JSON file written by shaka_proximity.py"""
    try:
        if os.path.exists(PROXIMITY_STATE_FILE):
            with open(PROXIMITY_STATE_FILE, "r") as f:
                data = json.load(f)
            # Check if data is stale (>10s old)
            last_update = data.get("lastUpdate", 0)
            if time.time() - last_update > 10:
                data["stale"] = True
            data["ok"] = True
            return data
        return {"ok": True, "connected": False, "error": "No proximity state file"}
    except Exception as e:
        return {"ok": False, "connected": False, "error": str(e)}

def reset_proximity_counter() -> Dict[str, Any]:
    """Reset the presence counter on the Evo Swipe Plus sensor."""
    try:
        # Write a reset request that the proximity service will pick up
        reset_file = "/tmp/shaka_proximity_reset"
        with open(reset_file, "w") as f:
            f.write("reset")
        return {"ok": True, "message": "Reset requested"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def check_door_status() -> Dict[str, Any]:
    """Check door status via shaka_validation2.py"""
    script_path = os.getenv("SHAKA_SCRIPT", "/home/shaka/shaka_validation2.py")
    
    try:
        cmd = ["python3", script_path, "--door"]
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=10
        )
        
        # Parse door status from output - CORRECT LOGIC
        # Script outputs "🚪 Porte OUVERTE" when door is open
        # Script outputs "✅ Porte fermée" when door is closed
        is_open = "Porte OUVERTE" in result.stdout or "OUVERTE" in result.stdout
        is_closed = "Porte fermée" in result.stdout or "fermée" in result.stdout
        
        return {
            "ok": result.returncode == 0,
            "isOpen": is_open,
            "isClosed": is_closed,
            "status": "open" if is_open else ("closed" if is_closed else "unknown"),
            "message": result.stdout.strip(),
            "stdout": result.stdout,
            "stderr": result.stderr,
            "returncode": result.returncode
        }
    except Exception as e:
        return {
            "ok": False,
            "isOpen": False,
            "isClosed": False,
            "status": "error",
            "message": f"Error: {str(e)}",
            "stdout": "",
            "stderr": str(e),
            "returncode": -1
        }



# ---------------------------------------------------------------------------
# Stripe Terminal Payment Integration
# ---------------------------------------------------------------------------

def stripe_start_payment(items_data: list, machine_id: str = "default") -> Dict[str, Any]:
    """Start a Stripe Terminal payment session with multi-vend support."""
    terminal = get_terminal()
    
    if not terminal.connected:
        if not terminal.connect():
            return {"ok": False, "error": "Cannot connect to Stripe Terminal"}
    
    try:
        items = []
        for item in items_data:
            items.append(VendItem(
                code=int(item.get("code", 0)),
                price=int(item.get("price", 0)),
                name=str(item.get("name", "")),
                unit=int(item.get("unit", 1)),
                qty=int(item.get("qty", 1)),
            ))
        
        if not items:
            return {"ok": False, "error": "No items provided"}
        
        session = terminal.start_payment(items)
        return {
            "ok": True,
            "message": "Payment session started",
            "session": session.to_dict(),
            "machineId": machine_id,
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}


def stripe_add_item(item_data: dict) -> Dict[str, Any]:
    """Add an item to the current session (multi-vend)."""
    terminal = get_terminal()
    try:
        item = VendItem(
            code=int(item_data.get("code", 0)),
            price=int(item_data.get("price", 0)),
            name=str(item_data.get("name", "")),
            unit=int(item_data.get("unit", 1)),
            qty=int(item_data.get("qty", 1)),
        )
        session = terminal.add_item_to_session(item)
        return {
            "ok": True,
            "message": "Item added to session",
            "session": session.to_dict(),
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}


STRIPE_STATE_FILE = "/tmp/shaka_stripe_state.json"

def stripe_get_status() -> Dict[str, Any]:
    """Get current Stripe Terminal payment state."""
    try:
        if os.path.exists(STRIPE_STATE_FILE):
            with open(STRIPE_STATE_FILE, "r") as f:
                snapshot = json.load(f)
            snapshot["ok"] = True
            return snapshot
    except Exception:
        pass
    # Fallback to in-process instance
    terminal = get_terminal()
    snapshot = terminal.get_state_snapshot()
    snapshot["ok"] = True
    return snapshot


def stripe_vend_result(success: bool) -> Dict[str, Any]:
    """Report vend result (success/failure) → capture or cancel payment."""
    terminal = get_terminal()
    try:
        if success:
            terminal.vend_success()
        else:
            terminal.vend_failure()
        return {"ok": True, "message": "Vend result reported", "success": success}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def stripe_cancel() -> Dict[str, Any]:
    """Cancel current Stripe Terminal session."""
    terminal = get_terminal()
    try:
        terminal.cancel_session()
        return {"ok": True, "message": "Session cancelled"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def stripe_reset() -> Dict[str, Any]:
    """Reset Stripe Terminal to idle state."""
    terminal = get_terminal()
    try:
        terminal.reset()
        return {"ok": True, "message": "Reset to idle"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def stripe_apply_config(data: dict) -> Dict[str, Any]:
    """Apply Stripe config pushed from Fleet Manager. Writes /etc/default/shaka-stripe."""
    env_content = data.get("envContent", "")
    config = data.get("config", {})

    if not env_content and not config:
        return {"ok": False, "error": "No config provided"}

    env_path = "/etc/default/shaka-stripe"
    try:
        # Build env content from config if not provided as raw text
        if not env_content and config:
            lines = [
                "# Stripe Terminal Configuration",
                "# Pushed from Fleet Manager",
                f"# Updated: {time.strftime('%Y-%m-%dT%H:%M:%S')}",
                "",
                f"STRIPE_SECRET_KEY={config.get('secretKey', '')}",
                f"STRIPE_READER_ID={config.get('readerId', '')}",
                f"MACHINE_ID={config.get('machineId', os.getenv('MACHINE_ID', 'default'))}",
                f"STRIPE_SIMULATION={'1' if config.get('simulation', True) else '0'}",
                f"STRIPE_DECIMAL_PLACES={config.get('decimalPlaces', 2)}",
                f"STRIPE_API_TIMEOUT={config.get('apiTimeout', 15)}",
                f"STRIPE_VEND_RESULT_TIMEOUT={config.get('vendResultTimeout', 30)}",
                f"STRIPE_PREAUTH_MAX_AMOUNT={config.get('preauthMaxAmount', 5000)}",
                "STRIPE_STATE_FILE=/tmp/shaka_stripe_state.json",
                "",
            ]
            env_content = "\n".join(lines)

        with open(env_path, "w") as f:
            f.write(env_content)

        logging.getLogger("vend").info(f"[STRIPE-CONFIG] Written to {env_path}")
        return {
            "ok": True,
            "message": f"Config written to {env_path}",
            "note": "Restart shaka-payment and shaka-vend services to apply",
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}


class VendHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        content_length = int(self.headers.get("Content-Length", 0))
        if content_length > 4096:
            self._json_response({"ok": False, "error": "Payload too large"}, 400)
            return
        
        body = self.rfile.read(content_length).decode("utf-8") if content_length > 0 else ""
        
        try:
            data = json.loads(body) if body else {}
        except json.JSONDecodeError:
            self._json_response({"ok": False, "error": "Invalid JSON"}, 400)
            return

        # --- Stripe Terminal payment routes ---
        if self.path == "/stripe/pay":
            items = data.get("items", [])
            machine_id = data.get("machineId", "default")
            result = stripe_start_payment(items, machine_id)
            self._json_response(result, 200 if result["ok"] else 500)
            return

        if self.path == "/stripe/add-item":
            item = data.get("item", data)
            result = stripe_add_item(item)
            self._json_response(result, 200 if result["ok"] else 500)
            return

        if self.path == "/stripe/vend-result":
            success = data.get("success", False)
            result = stripe_vend_result(success)
            self._json_response(result, 200 if result["ok"] else 500)
            return

        if self.path == "/stripe/webhook":
            # Forwarded Stripe webhook from Fleet Manager
            event_type = data.get("eventType", "")
            payload = data.get("payload", data)
            terminal = get_terminal()
            result_data = terminal.handle_webhook(event_type, payload)
            result_data["ok"] = True
            self._json_response(result_data, 200)
            return

        if self.path == "/stripe/cancel":
            result = stripe_cancel()
            self._json_response(result, 200)
            return

        if self.path == "/stripe/reset":
            result = stripe_reset()
            self._json_response(result, 200)
            return

        if self.path == "/stripe/config":
            # Receive Stripe config push from Fleet Manager
            result = stripe_apply_config(data)
            self._json_response(result, 200 if result["ok"] else 500)
            return

        # --- Original vend route ---
        if self.path == "/vend":
            try:
                location = data.get("location", "").strip()
                seq_direct = data.get("seq", "").strip()
                use_relay = data.get("useRelay", False)
                machine_id = data.get("machineId", "default")

                if not location and not seq_direct and not use_relay:
                    self._json_response({"ok": False, "error": "Missing location, seq, or relay flag"}, 400)
                    return

                if use_relay:
                    seq = ""
                elif seq_direct:
                    seq = seq_direct
                else:
                    seq = normalize_to_seq(location)

                result = run_vend(seq, use_relay)
                result["machineId"] = machine_id

                if use_relay and result.get("ok"):
                    result["datasetCapture"] = _start_dataset_capture()

                self._json_response(result, 200 if result["ok"] else 500)

            except json.JSONDecodeError:
                self._json_response({"ok": False, "error": "Invalid JSON"}, 400)
            except Exception as e:
                self._json_response({"ok": False, "error": f"Server error: {str(e)}"}, 500)
            return

        self.send_error(404)

    def do_GET(self):
        if self.path == "/":
            self._json_response({"ok": True, "message": "Vend server running"})
        elif self.path == "/proximity/status":
            result = get_proximity_status()
            self._json_response(result, 200)
        elif self.path == "/proximity/stats/today":
            result = get_today_stats()
            self._json_response(result, 200)
        elif self.path == "/proximity/stats/week":
            result = get_weekly_stats()
            self._json_response(result, 200)
        elif self.path.startswith("/proximity/stats/date/"):
            date_str = self.path.split("/")[-1]
            result = get_daily_stats(date_str)
            self._json_response(result, 200)
        elif self.path == "/proximity/events":
            result = get_recent_events(50)
            self._json_response(result, 200)
        elif self.path == "/proximity/summary":
            result = get_summary_for_heartbeat()
            result["ok"] = True
            self._json_response(result, 200)
        elif self.path == "/proximity/reset":
            result = reset_proximity_counter()
            self._json_response(result, 200)
        elif self.path == "/stripe/status":
            result = stripe_get_status()
            self._json_response(result, 200)
        elif self.path == "/health":
            self._json_response({"ok": True, "status": "healthy"})
        elif self.path == "/door-status":
            result = check_door_status()
            self._json_response(result, 200 if result["ok"] else 500)
        elif self.path == "/payment-status":
            result = get_payment_status()
            self._json_response(result, 200)
        elif self.path.startswith("/payment-status/set/"):
            status = self.path.split("/")[-1]
            if status in ("approved", "denied", "pending"):
                result = set_payment_status(status)
                self._json_response(result, 200)
            else:
                self._json_response({"ok": False, "error": "Invalid status"}, 400)
        elif self.path == "/payment-status/clear":
            result = clear_payment_status()
            self._json_response(result, 200)
        else:
            self.send_error(404)

    def _json_response(self, data: Dict[str, Any], status: int = 200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()


def main():
    try:
        init_proximity_db()
    except Exception:
        pass
    port = int(os.environ.get("PORT", 5001))
    server_address = ("", port)
    httpd = HTTPServer(server_address, VendHandler)
    print(f"Vend server listening on port {port}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server...")
        httpd.server_close()


if __name__ == "__main__":
    main()
