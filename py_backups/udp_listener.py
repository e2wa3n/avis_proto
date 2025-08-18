"""
udp_listener.py
---------------

Listens for UDP packets on LoRaWAN port 1700 and routes valid packets for processing.

This module is used by the EnviroPulse dispatcher to receive raw UDP packets from LoRaWAN gateways.
It does not decode or decrypt the packet contents. It simply:

- Binds to 0.0.0.0:1700 (standard Semtech UDP LoRaWAN port)
- Accepts PUSH_DATA and PULL_DATA packets from gateways
- Routes valid packets to the provided callback
- Sends appropriate ACKs for Semtech UDP protocol
- Drops malformed or unsupported packets silently

Usage:
    The dispatcher should pass a `handle_push_data_callback(decoded_json, addr)` function
    to route any valid PUSH_DATA packet content.

Limitations:
    - This module is not responsible for any message decoding or key lookup
    - Decryption and protocol handling are delegated elsewhere
"""

import socket
import struct
import json
from pathlib import Path


UDP_IP = "0.0.0.0"
UDP_PORT = 1700


class UDPListener:
    def __init__(self, handle_push_data_callback, handle_pull_data_callback=None):
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self.sock.bind((UDP_IP, UDP_PORT))
        self.push_handler = handle_push_data_callback
        self.pull_handler = handle_pull_data_callback
        print(f"[udp_listener] Listening on UDP port {UDP_PORT}...")

    def extract_json_segment(self, data):
        try:
            start = data.find(b'{')
            end = data.rfind(b'}')
            if start == -1 or end == -1 or end <= start:
                return None
            segment = data[start:end + 1]
            return json.loads(segment.decode('utf-8', errors='ignore'))
        except Exception as e:
            print(f"[udp_listener] Failed to extract JSON segment: {e}")
            return None

    def listen_loop(self):
        while True:
            data, addr = self.sock.recvfrom(4096)
            if len(data) < 4:
                continue

            version = data[0]
            token = data[1:3]
            pkt_type = data[3]

            if pkt_type == 0x00:  # PUSH_DATA
                self.sock.sendto(struct.pack("!B2sB", version, token, 0x01), addr)
                print("[udp_listener] Sent PUSH_ACK")

                payload = self.extract_json_segment(data)
                if payload:
                    self.push_handler(payload, addr)
                else:
                    print("[udp_listener] Invalid PUSH_DATA payload")

            elif pkt_type == 0x02:  # PULL_DATA
                if self.pull_handler:
                    self.pull_handler(data, addr, token, version, self.sock)
                else:
                    self.sock.sendto(struct.pack("!B2sB", version, token, 0x04), addr)
                    print("[udp_listener] Sent PULL_ACK")


