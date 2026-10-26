#!/usr/bin/env python3
"""Bluetooth SPP to Supabase bridge for the Tool Tracker ESP32.

The bridge receives newline-delimited messages over the Windows Bluetooth COM
port. Accepted scanner messages have one format only:

    UID:F9D99729\n
Each accepted UID is inserted into the existing ``scan_events`` table. The
React application already polls that table, looks up the tool, and marks the
event as consumed. This script deliberately does not change tool status or
borrow records.
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import time
from collections import defaultdict
from datetime import datetime, timezone
from typing import Final

import requests
import serial
from dotenv import load_dotenv
from serial.tools import list_ports

UID_MESSAGE: Final = re.compile(r"^UID:([0-9A-Fa-f]{4,32})$")
ONLINE_MESSAGE: Final = "STATUS:ONLINE"


def env_value(name: str, fallback: str = "") -> str:
    return os.getenv(name, fallback).strip()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Receive ESP32 Bluetooth SPP NFC UIDs and forward them to Supabase."
    )
    parser.add_argument(
        "--port",
        default=env_value("BLUETOOTH_COM_PORT", "COM11"),
        help="Windows Bluetooth SPP COM port (default: COM11 or BLUETOOTH_COM_PORT).",
    )
    parser.add_argument(
        "--baud",
        type=int,
        default=int(env_value("BLUETOOTH_BAUD", "115200")),
        help="Bluetooth serial baud rate (default: 115200).",
    )
    parser.add_argument(
        "--device-id",
        default=env_value("SCANNER_DEVICE_ID", "ESP32-PN532-01"),
        help="Value stored in scan_events.device_id.",
    )
    parser.add_argument(
        "--scan-mode",
        default=env_value("SCAN_MODE", "checkout"),
        help="Value stored in scan_events.scan_mode.",
    )
    parser.add_argument(
        "--dedupe-seconds",
        type=float,
        default=float(env_value("DEDUPE_SECONDS", "2")),
        help="Ignore repeated identical UIDs within this many seconds (default: 2).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate and print messages but do not send anything to Supabase.",
    )
    parser.add_argument(
        "--list-ports",
        action="store_true",
        help="List serial ports and exit. Useful when the Bluetooth COM number changes.",
    )
    return parser.parse_args()


def print_ports() -> None:
    ports = list(list_ports.comports())
    if not ports:
        print("No serial ports found.")
        return
    print("Available serial ports:")
    for port in ports:
        print(f"  {port.device:<8} {port.description}")


def validate_config() -> tuple[str, str]:
    url = env_value("SUPABASE_URL").rstrip("/")
    anon_key = env_value("SUPABASE_ANON_KEY")
    if not url or not anon_key:
        raise RuntimeError(
            "SUPABASE_URL and SUPABASE_ANON_KEY are required. Copy .env.example to .env and fill them in."
        )
    if not url.startswith("https://"):
        raise RuntimeError("SUPABASE_URL must start with https://")
    return url, anon_key


def submit_scan(
    session: requests.Session,
    supabase_url: str,
    anon_key: str,
    uid: str,
    device_id: str,
    scan_mode: str,
) -> None:
    response = session.post(
        f"{supabase_url}/rest/v1/scan_events",
        headers={
            "apikey": anon_key,
            "Authorization": f"Bearer {anon_key}",
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        },
        json={
            "uid": uid,
            "device_id": device_id,
            "scan_mode": scan_mode,
            "consumed": False,
        },
        timeout=12,
    )
    if not 200 <= response.status_code < 300:
        body = response.text[:500].replace("\n", " ")
        raise RuntimeError(f"Supabase returned HTTP {response.status_code}: {body}")


def submit_heartbeat(
    session: requests.Session,
    supabase_url: str,
    anon_key: str,
    device_id: str,
) -> None:
    """Upsert one status row without creating a fake scan event."""
    response = session.post(
        f"{supabase_url}/rest/v1/scanner_status?on_conflict=device_id",
        headers={
            "apikey": anon_key,
            "Authorization": f"Bearer {anon_key}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=minimal",
        },
        json={
            "device_id": device_id,
            "transport": "Bluetooth Classic SPP",
            "last_seen": datetime.now(timezone.utc).isoformat(),
        },
        timeout=12,
    )
    if not 200 <= response.status_code < 300:
        body = response.text[:500].replace("\n", " ")
        raise RuntimeError(f"Supabase returned HTTP {response.status_code}: {body}")


def send_ack(bluetooth: serial.Serial, uid: str, result: str) -> None:
    """Tell the ESP32 whether Supabase accepted this exact scan event."""
    bluetooth.write(f"ACK:{uid}:{result}\n".encode("utf-8"))
    bluetooth.flush()


def run_bridge(args: argparse.Namespace) -> int:
    if args.list_ports:
        print_ports()
        return 0

    try:
        supabase_url, anon_key = validate_config()
    except RuntimeError as error:
        print(f"Configuration error: {error}", file=sys.stderr)
        return 2

    if args.dedupe_seconds < 0:
        print("Configuration error: --dedupe-seconds cannot be negative.", file=sys.stderr)
        return 2

    print("Aircraft Tool Tracker Bluetooth Bridge")
    print(f"Bluetooth port: {args.port} at {args.baud} baud")
    print(f"Device ID: {args.device_id}; scan mode: {args.scan_mode}")
    print("Expected ESP32 message: UID:F9D99729")
    if args.dry_run:
        print("DRY RUN enabled: no data will be sent to Supabase.")

    last_sent: dict[str, float] = defaultdict(float)
    session = requests.Session()

    while True:
        try:
            print(f"Opening Bluetooth serial port {args.port}...")
            with serial.Serial(args.port, args.baud, timeout=1) as bluetooth:
                print("Connected. Waiting for NFC scans (Ctrl+C to stop).")
                while True:
                    raw = bluetooth.readline()
                    if not raw:
                        continue
                    message = raw.decode("utf-8", errors="replace").strip()
                    if not message:
                        continue

                    print(f"Received: {message}")
                    if message == ONLINE_MESSAGE:
                        if args.dry_run:
                            print("Validated ESP32 online heartbeat; not sent because --dry-run is enabled.")
                            continue
                        try:
                            submit_heartbeat(session, supabase_url, anon_key, args.device_id)
                        except (requests.RequestException, RuntimeError) as error:
                            print(f"Scanner heartbeat upload failed: {error}", file=sys.stderr)
                            continue
                        print("ESP32 Bluetooth heartbeat recorded.")
                        continue

                    match = UID_MESSAGE.fullmatch(message)
                    if not match:
                        print("Ignored: expected format UID:<hexadecimal UID>.")
                        continue

                    uid = match.group(1).upper()
                    now = time.monotonic()
                    elapsed = now - last_sent[uid]
                    if elapsed < args.dedupe_seconds:
                        print(f"Ignored duplicate UID {uid} ({elapsed:.1f}s since previous event).")
                        continue

                    if args.dry_run:
                        print(f"Validated UID {uid}; not sent because --dry-run is enabled.")
                        last_sent[uid] = now
                        continue

                    try:
                        submit_scan(
                            session,
                            supabase_url,
                            anon_key,
                            uid,
                            args.device_id,
                            args.scan_mode,
                        )
                    except (requests.RequestException, RuntimeError) as error:
                        print(f"Supabase upload failed for {uid}: {error}", file=sys.stderr)
                        try:
                            send_ack(bluetooth, uid, "FAIL")
                        except serial.SerialException as ack_error:
                            print(f"Could not send FAIL acknowledgement: {ack_error}", file=sys.stderr)
                        # Do not update last_sent: the next physical re-scan can retry the event.
                        continue

                    last_sent[uid] = now
                    print(f"Supabase accepted scan event for UID {uid}.")
                    try:
                        send_ack(bluetooth, uid, "OK")
                        print(f"Sent ACK:{uid}:OK to ESP32.")
                    except serial.SerialException as ack_error:
                        print(f"Could not send success acknowledgement: {ack_error}", file=sys.stderr)

        except serial.SerialException as error:
            print(f"Bluetooth serial connection error: {error}", file=sys.stderr)
            print("Retrying in 3 seconds. Check pairing, the COM port, and that Tera Term is closed.")
            time.sleep(3)
        except KeyboardInterrupt:
            print("\nBridge stopped.")
            return 0


if __name__ == "__main__":
    load_dotenv()
    raise SystemExit(run_bridge(parse_args()))
