#!/usr/bin/env python3
from __future__ import annotations

import os
import re
import subprocess
from typing import Any, Dict, Optional, Tuple

from flask import Flask, jsonify, request
from flask_cors import CORS


app = Flask(__name__)
CORS(app)


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


@app.get("/health")
def health():
    return jsonify({"ok": True})


@app.get("/door-status")
def door_status():
    """Check door status using shaka_validation2.py --door"""
    script_path = os.environ.get("SHAKA_SCRIPT", "/home/shaka/shaka_validation2.py")
    python_bin = os.environ.get("PYTHON_BIN", "python3")

    try:
        proc = subprocess.run(
            [python_bin, script_path, "--door"],
            capture_output=True,
            text=True,
            timeout=5
        )
        stdout = (proc.stdout or "").strip()
        
        if "Porte OUVERTE" in stdout or "OUVERTE" in stdout:
            return jsonify({"ok": True, "status": "open"})
        elif "Porte fermée" in stdout or "fermée" in stdout:
            return jsonify({"ok": True, "status": "closed"})
        else:
            return jsonify({"ok": True, "status": "unknown", "stdout": stdout})
    except subprocess.TimeoutExpired:
        return jsonify({"ok": False, "status": "error", "error": "Timeout"}), 504
    except Exception as e:
        return jsonify({"ok": False, "status": "error", "error": str(e)}), 500


@app.post("/vend")
def vend():
    body: Dict[str, Any] = request.get_json(silent=True) or {}
    location = body.get("location")
    seq = body.get("seq")

    try:
        if seq:
            final_seq = normalize_to_seq(str(seq))
        else:
            final_seq = normalize_to_seq(str(location))
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 400

    script_path = os.environ.get("SHAKA_SCRIPT", "/home/pi/shaka_validation2.py")
    python_bin = os.environ.get("PYTHON_BIN", "python3")

    active_low = os.environ.get("ACTIVE_LOW", "0") == "1"
    drop_gpio = os.environ.get("DROP_GPIO", "17")
    drop_edge = os.environ.get("DROP_EDGE", "FALLING")
    drop_timeout = os.environ.get("DROP_TIMEOUT", "10")
    drop_bounce_ms = os.environ.get("DROP_BOUNCE_MS", "40")
    drop_retries = os.environ.get("DROP_RETRIES", "1")

    cmd = [
        python_bin,
        script_path,
        "--seq",
        final_seq,
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

    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=float(drop_timeout) + 15)
    except subprocess.TimeoutExpired:
        return jsonify({"success": False, "seq": final_seq, "error": "Timeout running vending script"}), 504
    except Exception as e:
        return jsonify({"success": False, "seq": final_seq, "error": str(e)}), 500

    stdout = (proc.stdout or "").strip()
    stderr = (proc.stderr or "").strip()

    drop_detected, has_drop_info = parse_drop_result(stdout)
    ok = proc.returncode == 0 and ("DONE: SUCCESS" in stdout)

    res: Dict[str, Any] = {
        "success": bool(ok),
        "seq": final_seq,
        "message": "OK" if ok else "FAIL",
        "stdout": stdout,
        "stderr": stderr,
        "exitCode": proc.returncode,
    }

    if has_drop_info:
        res["dropDetected"] = drop_detected

    return jsonify(res), (200 if ok else 500)


if __name__ == "__main__":
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "5001"))
    app.run(host=host, port=port)
