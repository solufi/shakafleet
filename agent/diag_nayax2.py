#!/usr/bin/env python3
"""
Diagnostic #2: Try different ACK response formats to find what clears V00.

The Nayax VPOS expects a specific VMC response to consider the link "active".
We'll try several response patterns:
  Test 1: flags=0x00 data=0x00000000 (current - idle ACK)
  Test 2: flags=0x01 data=0x00000000 (mirror poll flag)
  Test 3: flags=0x00 data=0xFFFFFFFF (mirror idle data)
  Test 4: flags=0x01 data=0xFFFFFFFF (mirror both)
  Test 5: flags=0x00 data=0x00000001 (VMC ready indicator?)

Each test runs for 15 seconds. Watch the Nayax display for V00 clearing.
"""
import serial
import struct
import time
import sys

def crc16(data):
    crc = 0x0000
    for b in data:
        crc ^= b << 8
        for _ in range(8):
            if crc & 0x8000:
                crc = (crc << 1) ^ 0x1021
            else:
                crc <<= 1
            crc &= 0xFFFF
    return crc

TESTS = [
    ("flags=0x00 data=00000000 (current idle ACK)", b'\x00\x00\x00\x00', 0x00),
    ("flags=0x01 data=00000000 (mirror poll flag)", b'\x00\x00\x00\x00', 0x01),
    ("flags=0x00 data=FFFFFFFF (mirror idle data)", b'\xff\xff\xff\xff', 0x00),
    ("flags=0x01 data=FFFFFFFF (mirror both)",      b'\xff\xff\xff\xff', 0x01),
    ("flags=0x00 data=00000001 (VMC ready?)",        b'\x00\x00\x00\x01', 0x00),
]

# Allow selecting a specific test via command line
if len(sys.argv) > 1:
    test_idx = int(sys.argv[1])
    TESTS = [TESTS[test_idx]]
    print("Running single test #%d" % test_idx)

ser = serial.Serial('/dev/ttyUSB0', 115200, timeout=1.0)
ser.reset_input_buffer()

for test_name, resp_data, resp_flags in TESTS:
    print("")
    print("=" * 60)
    print("TEST: %s" % test_name)
    print("=" * 60)
    
    buf = b''
    start = time.time()
    count = 0
    duration = 15
    
    while time.time() - start < duration:
        chunk = ser.read(64)
        if not chunk:
            continue
        buf += chunk
        while len(buf) >= 11:
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

            payload = raw[:9]
            recv_crc = struct.unpack('<H', raw[9:11])[0]
            calc_crc = crc16(payload)
            if recv_crc != calc_crc:
                continue

            seq = raw[1:4]
            rx_data = raw[4:8]
            rx_flags = raw[8]

            count += 1

            # Build response with test data/flags
            resp_payload = b'\x09' + seq + resp_data + bytes([resp_flags])
            resp_crc_val = crc16(resp_payload)
            resp = resp_payload + struct.pack('<H', resp_crc_val)
            ser.write(resp)
            ser.flush()

            if count <= 3 or count % 10 == 0:
                elapsed = time.time() - start
                print("  RX #%3d t=%5.1fs: flags=0x%02x data=%s | TX: flags=0x%02x data=%s" % (
                    count, elapsed, rx_flags, rx_data.hex(), resp_flags, resp_data.hex()))

    print("  -> %d packets exchanged in %ds" % (count, duration))
    print("  >> CHECK NAYAX DISPLAY NOW - did V00 clear?")
    
    if len(TESTS) > 1:
        print("  Waiting 5s before next test...")
        # Drain any remaining data
        time.sleep(1)
        ser.reset_input_buffer()
        time.sleep(4)

ser.close()
print("")
print("Done. Restart shaka-nayax with: sudo systemctl start shaka-nayax.service")
