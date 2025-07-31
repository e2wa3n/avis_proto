#!/usr/bin/env python3
import socket, struct, json, base64

# where to send
UDP_IP   = "127.0.0.1"
UDP_PORT = 1700

# Semtech header: version=2, token (2 bytes), pkt_type=0x00 (PUSH_DATA)
version  = 2
token    = b'\x00\x01'
pkt_type = 0x00

# minimal “phy” payload: 
#   MHDR(1) + DevAddr(4) + FCnt(2) + FCtrl(1) + 4‑byte MIC
dummy_phy = b'\x40'           \
          + b'\x01\x02\x03\x04' \
          + (0).to_bytes(2,'little') \
          + b'\x00'           \
          + b'\xAA\xBB\xCC\xDD'

# wrap in JSON under “rxpk”
packet = {
    "rxpk": [
      { "data": base64.b64encode(dummy_phy).decode() }
    ]
}

# serialize & prepend header
payload = json.dumps(packet).encode()
msg     = struct.pack("!B2sB", version, token, pkt_type) + payload

# send it
sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
sock.sendto(msg, (UDP_IP, UDP_PORT))
print(f"Sent {len(msg)} bytes to {UDP_IP}:{UDP_PORT}")
