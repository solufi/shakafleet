#!/usr/bin/env python3
"""
Proximity Event Logger — SQLite persistent storage
====================================================
Logs all proximity events (presence, engagement, gesture, etc.)
to a local SQLite database for analytics and reporting.

The vend server reads this DB to serve stats via API endpoints.
"""
from __future__ import annotations

import json
import os
import sqlite3
import threading
import time
from typing import Any, Dict, List, Optional

DB_PATH = os.getenv("EVO_DB_PATH", "/home/shaka/proximity_events.db")

_local = threading.local()


def _get_conn() -> sqlite3.Connection:
    """Get a thread-local SQLite connection."""
    if not hasattr(_local, "conn") or _local.conn is None:
        _local.conn = sqlite3.connect(DB_PATH, timeout=5)
        _local.conn.row_factory = sqlite3.Row
        _local.conn.execute("PRAGMA journal_mode=WAL")
        _local.conn.execute("PRAGMA synchronous=NORMAL")
    return _local.conn


def init_db():
    """Create tables if they don't exist."""
    conn = _get_conn()
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS proximity_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp REAL NOT NULL,
            date TEXT NOT NULL,
            hour INTEGER NOT NULL,
            event_type TEXT NOT NULL,
            data TEXT,
            distance_mm INTEGER DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_events_date ON proximity_events(date);
        CREATE INDEX IF NOT EXISTS idx_events_type ON proximity_events(event_type);
        CREATE INDEX IF NOT EXISTS idx_events_timestamp ON proximity_events(timestamp);

        CREATE TABLE IF NOT EXISTS proximity_daily_stats (
            date TEXT NOT NULL,
            hour INTEGER NOT NULL,
            presence_count INTEGER DEFAULT 0,
            engagement_count INTEGER DEFAULT 0,
            gesture_left INTEGER DEFAULT 0,
            gesture_right INTEGER DEFAULT 0,
            avg_distance_mm REAL DEFAULT 0,
            min_distance_mm INTEGER DEFAULT 0,
            max_visit_duration_s REAL DEFAULT 0,
            updated_at REAL NOT NULL,
            PRIMARY KEY (date, hour)
        );
    """)
    conn.commit()


def log_event(event_type: str, data: Any = None, distance_mm: int = 0):
    """Log a proximity event to the database."""
    try:
        conn = _get_conn()
        now = time.time()
        from datetime import datetime
        dt = datetime.fromtimestamp(now)
        date_str = dt.strftime("%Y-%m-%d")
        hour = dt.hour

        conn.execute(
            "INSERT INTO proximity_events (timestamp, date, hour, event_type, data, distance_mm) VALUES (?, ?, ?, ?, ?, ?)",
            (now, date_str, hour, event_type, json.dumps(data) if data else None, distance_mm)
        )
        conn.commit()

        # Update hourly stats
        _update_hourly_stats(conn, date_str, hour, event_type, distance_mm)
    except Exception as e:
        import logging
        logging.getLogger("proximity_logger").error(f"Failed to log event: {e}")


def _update_hourly_stats(conn: sqlite3.Connection, date: str, hour: int, event_type: str, distance_mm: int):
    """Update the hourly aggregated stats."""
    now = time.time()

    # Upsert the row
    conn.execute("""
        INSERT INTO proximity_daily_stats (date, hour, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(date, hour) DO UPDATE SET updated_at = ?
    """, (date, hour, now, now))

    if event_type == "presence":
        conn.execute("""
            UPDATE proximity_daily_stats
            SET presence_count = presence_count + 1
            WHERE date = ? AND hour = ?
        """, (date, hour))
    elif event_type == "engagement":
        conn.execute("""
            UPDATE proximity_daily_stats
            SET engagement_count = engagement_count + 1
            WHERE date = ? AND hour = ?
        """, (date, hour))
    elif event_type == "gesture":
        pass  # handled below

    if event_type == "gesture_left":
        conn.execute("""
            UPDATE proximity_daily_stats
            SET gesture_left = gesture_left + 1
            WHERE date = ? AND hour = ?
        """, (date, hour))
    elif event_type == "gesture_right":
        conn.execute("""
            UPDATE proximity_daily_stats
            SET gesture_right = gesture_right + 1
            WHERE date = ? AND hour = ?
        """, (date, hour))

    if distance_mm > 0:
        conn.execute("""
            UPDATE proximity_daily_stats
            SET avg_distance_mm = (
                SELECT AVG(distance_mm) FROM proximity_events
                WHERE date = ? AND hour = ? AND distance_mm > 0
            ),
            min_distance_mm = (
                SELECT MIN(distance_mm) FROM proximity_events
                WHERE date = ? AND hour = ? AND distance_mm > 0
            )
            WHERE date = ? AND hour = ?
        """, (date, hour, date, hour, date, hour))

    conn.commit()


# ---------------------------------------------------------------------------
# Query functions (called by vend server API)
# ---------------------------------------------------------------------------

def get_today_stats() -> Dict[str, Any]:
    """Get today's aggregated stats."""
    from datetime import datetime
    today = datetime.now().strftime("%Y-%m-%d")
    return get_daily_stats(today)


def get_daily_stats(date: str) -> Dict[str, Any]:
    """Get stats for a specific date."""
    try:
        conn = _get_conn()
        rows = conn.execute(
            "SELECT * FROM proximity_daily_stats WHERE date = ? ORDER BY hour",
            (date,)
        ).fetchall()

        hourly = []
        totals = {
            "date": date,
            "presence_count": 0,
            "engagement_count": 0,
            "gesture_left": 0,
            "gesture_right": 0,
            "conversion_rate": 0.0,
        }

        for row in rows:
            entry = dict(row)
            hourly.append(entry)
            totals["presence_count"] += entry["presence_count"]
            totals["engagement_count"] += entry["engagement_count"]
            totals["gesture_left"] += entry["gesture_left"]
            totals["gesture_right"] += entry["gesture_right"]

        if totals["presence_count"] > 0:
            totals["conversion_rate"] = round(
                totals["engagement_count"] / totals["presence_count"] * 100, 1
            )

        totals["gesture_total"] = totals["gesture_left"] + totals["gesture_right"]

        return {"ok": True, "totals": totals, "hourly": hourly}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def get_weekly_stats() -> Dict[str, Any]:
    """Get stats for the last 7 days."""
    from datetime import datetime, timedelta
    try:
        conn = _get_conn()
        end_date = datetime.now()
        start_date = end_date - timedelta(days=6)
        start_str = start_date.strftime("%Y-%m-%d")
        end_str = end_date.strftime("%Y-%m-%d")

        rows = conn.execute("""
            SELECT date,
                   SUM(presence_count) as presence_count,
                   SUM(engagement_count) as engagement_count,
                   SUM(gesture_left) as gesture_left,
                   SUM(gesture_right) as gesture_right
            FROM proximity_daily_stats
            WHERE date >= ? AND date <= ?
            GROUP BY date
            ORDER BY date
        """, (start_str, end_str)).fetchall()

        daily = []
        totals = {
            "period": f"{start_str} to {end_str}",
            "presence_count": 0,
            "engagement_count": 0,
            "gesture_left": 0,
            "gesture_right": 0,
            "conversion_rate": 0.0,
        }

        for row in rows:
            entry = dict(row)
            daily.append(entry)
            totals["presence_count"] += entry["presence_count"]
            totals["engagement_count"] += entry["engagement_count"]
            totals["gesture_left"] += entry["gesture_left"]
            totals["gesture_right"] += entry["gesture_right"]

        if totals["presence_count"] > 0:
            totals["conversion_rate"] = round(
                totals["engagement_count"] / totals["presence_count"] * 100, 1
            )

        totals["gesture_total"] = totals["gesture_left"] + totals["gesture_right"]

        return {"ok": True, "totals": totals, "daily": daily}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def get_recent_events(limit: int = 50) -> Dict[str, Any]:
    """Get the most recent events."""
    try:
        conn = _get_conn()
        rows = conn.execute(
            "SELECT * FROM proximity_events ORDER BY timestamp DESC LIMIT ?",
            (limit,)
        ).fetchall()

        events = [dict(row) for row in rows]
        return {"ok": True, "events": events, "count": len(events)}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def get_summary_for_heartbeat() -> Dict[str, Any]:
    """Get a compact summary suitable for sending in heartbeat to fleet manager."""
    from datetime import datetime
    today = datetime.now().strftime("%Y-%m-%d")
    try:
        conn = _get_conn()
        row = conn.execute("""
            SELECT
                SUM(presence_count) as presence_today,
                SUM(engagement_count) as engagement_today,
                SUM(gesture_left + gesture_right) as gestures_today
            FROM proximity_daily_stats
            WHERE date = ?
        """, (today,)).fetchone()

        if row and row["presence_today"] is not None:
            presence = row["presence_today"]
            engagement = row["engagement_today"]
            return {
                "presence_today": presence,
                "engagement_today": engagement,
                "gestures_today": row["gestures_today"] or 0,
                "conversion_rate": round(engagement / presence * 100, 1) if presence > 0 else 0.0,
                "date": today,
            }
        return {
            "presence_today": 0,
            "engagement_today": 0,
            "gestures_today": 0,
            "conversion_rate": 0.0,
            "date": today,
        }
    except Exception as e:
        return {"error": str(e)}
