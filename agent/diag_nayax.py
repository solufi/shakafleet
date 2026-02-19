#!/usr/bin/env python3
"""Diagnostic: capture Nayax poll packets and send ACK responses for 30s."""
import serial
import struct
import time

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

ser = serial.Serial('/dev/ttyUSB0', 115200, timeout=1.0)
ser.reset_input_buffer()
buf = b''
start = time.time()
count = 0
no_data_count = 0
print('Listening for Nayax packets (30s)...')

while time.time() - start < 30:
    chunk = ser.read(64)
    if not chunk:
        no_data_count += 1
        if count > 0 and no_data_count == 3:
            print('  [no data for 3s - Nayax stopped polling]')
        continue
    no_data_count = 0
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
        crc_ok = recv_crc == calc_crc
        crc_str = "OK" if crc_ok else "BAD"

        seq = raw[1:4]
        data = raw[4:8]
        flags = raw[8]

        count += 1
        elapsed = time.time() - start

        # Send response - echo same seq, idle data, flag 0x00
        resp_payload = b'\x09' + seq + b'\x00\x00\x00\x00' + b'\x00'
        resp_crc = crc16(resp_payload)
        resp = resp_payload + struct.pack('<H', resp_crc)
        ser.write(resp)
        ser.flush()

        if count <= 10 or count % 20 == 0:
            print("RX #%3d t=%5.1fs: %s flags=0x%02x data=%s crc=%s" % (
                count, elapsed, raw.hex(), flags, data.hex(), crc_str))
            print("TX #%3d         : %s" % (count, resp.hex()))

ser.close()
print("")
print("Total: %d packets in 30s" % count)
