#!/usr/bin/env python3
"""
udp_ingest.py (v2)

A drop‑in replacement for udp_listener.py that:
  1) Listens for LoRaWAN UDP packets (same as before)
  2) Decrypts & decodes Avis events (same as before)
  3) Looks up the current session_id from your SQLite DB
  4) POSTS each decoded event as JSON to your Node.js /api/ingest endpoint

Every new import, function or block related to HTTP posting or session lookup
is marked with a “# ← NEW” comment.
"""

import socket
import struct
import json
import base64
from datetime import datetime
from pathlib import Path
from collections import deque

# ——— EXISTING crypto import —————————————————————————————
from Crypto.Cipher import AES

# ——— EXISTING project protocol import —————————————————————————
from protocol import Protocol


# ─── NEW: HTTP + DB imports ───────────────────────────────────────────────
import requests                    # ← HTTP client for POSTing to Node.js
import sqlite3                     # ← To fetch session_id from your SQLite DB


# ─── CONFIG ────────────────────────────────────────────────────────────────
UDP_IP     = "0.0.0.0"             # same as before: bind on all interfaces
UDP_PORT   = 1700                  # same as before: LoRaWAN port
LOG_PATH   = Path("udp_listener_log.json")  
DB_PATH    = "/home/ewan/Desktop/projects/web/users.db"  
INGEST_URL = "http://192.168.1.50:3000/api/ingest"  
                                    # ← NEW: replace with your web‑server’s LAN IP


# ─── Dedupe window ────────────────────────────────────────────────────────
seen_messages = deque(maxlen=100)


# ─── NEW: helper to grab the “current” session_id from sessions table ─────
def get_active_session_id():
    """
    Query your SQLite sessions table for the most-recent session_id.
    Returns None if no sessions exist yet.
    """
    try:
        conn = sqlite3.connect(DB_PATH)
        cur  = conn.cursor()
        cur.execute("""
          SELECT session_id
            FROM sessions
           ORDER BY p_date DESC
           LIMIT 1
        """)
        row = cur.fetchone()
        conn.close()
        return row[0] if row else None

    except Exception as e:
        print(f"⨯ Error fetching session_id from DB: {e}")
        return None


# ─── EXISTING: LoRaWAN decryption helper ───────────────────────────────────
def lorawan_payload_decrypt(appskey_hex, devaddr_hex, fcnt, direction, payload_hex):
    appskey    = bytes.fromhex(appskey_hex)
    devaddr    = bytes.fromhex(devaddr_hex)[::-1]
    fcnt_bytes = fcnt.to_bytes(4, 'little')
    payload    = bytes.fromhex(payload_hex)

    block  = b'\x01' + b'\x00'*4 + bytes([direction]) + devaddr + fcnt_bytes + b'\x00' + b'\x01'
    cipher = AES.new(appskey, AES.MODE_ECB)
    s_block = cipher.encrypt(block)
    return bytes(a ^ b for a, b in zip(payload, s_block))


# ─── EXISTING: load AppSKey registry ────────────────────────────────────────
def load_node_registry(path="node_registry.json"):
    try:
        with open(path) as f:
            return json.load(f)
    except Exception as e:
        print("Failed to load node registry:", e)
        return {}


# ─── EXISTING: init + append to local JSON log ─────────────────────────────
def init_log():
    if not LOG_PATH.exists():
        with open(LOG_PATH, 'w') as f:
            json.dump([], f, indent=2)

def append_log(entry: dict):
    try:
        with open(LOG_PATH, 'r+') as f:
            data = json.load(f)
            data.append(entry)
            f.seek(0)
            json.dump(data, f, indent=2)
            f.truncate()
    except Exception as e:
        print(f"[ERROR] Unable to write to log file: {e}")


# ─── EXISTING: pull out JSON blob from packet ───────────────────────────────
def extract_json_segment(data: bytes) -> dict:
    try:
        start = data.find(b'{')
        end   = data.rfind(b'}')
        if start == -1 or end <= start:
            return None
        segment = data[start:end+1]
        return json.loads(segment.decode('utf-8','ignore'))
    except Exception as e:
        print(f"[WARN] Failed to extract JSON segment: {e}")
        return None


# ─── HANDLER: PUSH_DATA (uplink) ────────────────────────────────────────────
def handle_push_data(data, addr, token, version, sock, node_registry):
    # 1) ACK back to gateway (same as original)
    ack = struct.pack("!B2sB", version, token, 0x01)
    sock.sendto(ack, addr)
    print("Sent PUSH_ACK")

    # 2) Extract embedded JSON (same as original)
    payload = extract_json_segment(data)
    if not payload:
        print("[WARN] No valid JSON payload found in PUSH_DATA")
        return

    # 3) For each rxpk: base64-decode, parse LoRa fields, dedupe (same as original)
    for rx in payload.get("rxpk", []):
        try:
            raw = base64.b64decode(rx.get("data",""))
        except Exception:
            print("[WARN] Invalid base64 in rxpk data")
            continue

        mhdr  = raw[0]
        devaddr = raw[1:5][::-1].hex().upper()
        fcnt  = int.from_bytes(raw[6:8], "little")
        frm_hex = raw[9:-4].hex()
        mic   = raw[-4:].hex()
        sig   = f"{devaddr}-{fcnt}-{frm_hex}"

        if sig in seen_messages:
            continue
        seen_messages.append(sig)

        # 4) decrypt FRMPayload (same as original)
        appskey = node_registry.get(devaddr,{}).get("appskey")
        if not appskey:
            print(f"[WARN] No AppSKey for {devaddr}")
            continue
        decrypted = lorawan_payload_decrypt(appskey, devaddr, fcnt, 0, frm_hex)

        # 5) decode Avis protocol (same as original)
        entry = {
            "received_at": datetime.utcnow().isoformat() + "Z",
            "devaddr": devaddr,
            "fcnt": fcnt,
            "encrypted_frm": frm_hex,
            "mic": mic,
            "decrypted_hex": decrypted.hex().upper()
        }
        try:
            proto = Protocol()
            ts, tax_code, conf_bin = proto.decode_avis_event(decrypted)
            dt = datetime.utcfromtimestamp(ts).isoformat() + "Z"
            try:
                common_name = proto.decode_taxonomy(tax_code)
            except:
                common_name = f"<unknown {tax_code}>"
            entry.update({
                "event_timestamp": dt,
                "taxonomy_code": tax_code,
                "common_name": common_name,
                "confidence_bin": conf_bin
            })
        except Exception as e:
            print(f"[WARN] Failed to decode Avis payload: {e}")
            entry["decode_error"] = str(e)

        # 6) NEW: build the JSON payload for ingestion
        bird_payload = {
            "type": 1,                           # 1 = bird_instance
            "session_id": get_active_session_id(),  # ← fetch current session
            "node_id": devaddr,
            "common_name": entry.get("common_name"),
            "confidence_level": entry.get("confidence_bin"),
            "time_stamp": entry.get("event_timestamp")
        }

        # guard: skip if no session yet
        if bird_payload["session_id"] is None:
            print("⨯ No active session; skipping HTTP POST")
        else:
            # 7) NEW: POST to your Node.js ingest endpoint
            try:
                resp = requests.post(INGEST_URL, json=bird_payload, timeout=5)
                resp.raise_for_status()
                print(f"✔ Ingested bird event for session {bird_payload['session_id']}")
            except Exception as e:
                print(f"⨯ Failed to POST bird event: {e}")

        # 8) OPTIONAL: still append locally if you want
        append_log(entry)


# ─── HANDLER: PULL_DATA (keep-alive) ────────────────────────────────────────
def handle_pull_data(data, addr, token, version, sock):
    ack = struct.pack("!B2sB", version, token, 0x04)
    sock.sendto(ack, addr)
    print("Sent PULL_ACK")


# ─── MAIN LOOP ─────────────────────────────────────────────────────────────
def main():
    # init local logfile
    init_log()

    # bind UDP socket
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind((UDP_IP, UDP_PORT))
    print(f"Listening on UDP {UDP_IP}:{UDP_PORT}…")

    # load your AppSKey registry
    node_registry = load_node_registry()

    # loop forever
    while True:
        data, addr = sock.recvfrom(4096)
        if len(data) < 4:
            continue
        version = data[0]
        token   = data[1:3]
        pkt     = data[3]
        if   pkt == 0x00:
            handle_push_data(data, addr, token, version, sock, node_registry)
        elif pkt == 0x02:
            handle_pull_data(data, addr, token, version, sock)


if __name__ == "__main__":
    main()
