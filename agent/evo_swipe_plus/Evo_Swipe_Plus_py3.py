#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import serial
import crcmod.predefined
import serial.tools.list_ports
import threading
import struct


class Evo_Swipe_Plus(object):
    TEXT_MODE = b"\x00\x11\x01\x45"
    BINARY_MODE = b"\x00\x11\x02\x4C"
    BIDIRECTIONAL_MODE = b"\x00\x21\x0A\x8D"
    SWIPE_MODE = b"\x00\x21\x06\xA9"
    PRESENCE_MODE = b"\x00\x21\x07\xAE"
    RESET_BIDIRECTIONAL_COUNTER = b"\x00\x55\x08\x00\x00\x00\x00\x7C"
    RESET_PRESENCE_COUNTER = b"\x00\x55\x09\x00\x00\x00\x00\x1E"
    GET_SENSOR_PARAMETERS = b"\x00\x61\x01\xE7"

    def __init__(self, portname=None):
        if portname is None:
            ports = list(serial.tools.list_ports.comports())
            for p in ports:
                if ":5740" in p[2]:
                    print("Evo Swipe Plus found on port {}".format(p[0]))
                    portname = p[0]
            if portname is None:
                print("Sensor not found. Please Check connections.")
                exit()
        self.portname = portname
        self.baudrate = 115200

        # Configure the serial connections
        self.port = serial.Serial(
            port=self.portname,
            baudrate=self.baudrate,
            parity=serial.PARITY_NONE,
            stopbits=serial.STOPBITS_ONE,
            bytesize=serial.EIGHTBITS
        )
        self.port.isOpen()
        self.crc8 = crcmod.predefined.mkPredefinedCrcFun('crc-8')
        self.serial_lock = threading.Lock()

    def get_ranges(self):
        # Read one byte
        data = []
        header = self.port.read(2)
        # print("HEADER:", header)

        if header == b'DD':
            # After DD read D1(2) + D2(2) + CRC (1) bytes
            frame = header + self.port.read(5)  # Try a two-range frame
            if frame[-1] != self.crc8(frame[:-1]):
                print("CRC mismatch. Check connection or make sure only one program accesses the sensor port.")
                return header, []

            rng = struct.unpack(">hh", frame[2:6])
            rng = list(rng)
            data = rng
            self.check_ranges(data)

        elif header == b'TT':
            frame = header + self.port.read(3)  # Try a single range frame
            if frame[-1] != self.crc8(frame[:-1]):
                print("CRC mismatch. Check connection or make sure only one progam accesses the sensor port.")
                return header, []

            rng = struct.unpack(">h", frame[2:4])
            rng = list(rng)
            data = rng
            self.check_ranges(data)

        elif header == b'PC':
            # After PC read 9 bytes (Bytes N° Inside(4), In(2), Out(2) + CRC(1))
            frame = header + self.port.read(9)  # Try a Bidirectional frame
            # print("FRAME:", frame)
            if frame[-1] != self.crc8(frame[:-1]):
                return header, "CRC mismatch."
            counts = struct.unpack(">lhh", frame[2:10])
            data = counts

        elif header == b'TS':
            # We can do readline because there is a newline character after each word
            data.append(self.port.readline())

        elif header == b'EE':
            data.append(self.port.readline())

        elif header == b'PP':
            # This one is a bit more complex, after the newline character there is a 4 bytes counter.
            frame = self.port.readline()
            data.append(frame)
            frame_counter = self.port.read(4)
            counts = struct.unpack(">l", frame_counter)
            data.append(counts)

        # This is the frame outputted when a reset presence counter function is called.
        elif header == b'PR':
            frame_counter = self.port.read(4)
            counts = struct.unpack(">l", frame_counter)
            data.append(counts)

        elif header == b'VV':
            data.append(self.port.readline())

        else:
            return "Waiting for frame header", header

        return header, data

    def get_parameters_values(self):

        sensor_parameters = {}
        header = self.port.read(2)
        # print("HEADER:", header)

        # Frame is: BPXXPDXXXXETXXXXGRXXXXXXXX
        if header == b'BP':
            frame = header + self.port.read(25)
            if frame[-1] != self.crc8(frame[:-1]):
                print("CRC mismatch. Check connection or make sure only one program accesses the sensor port.")
                return header, {}

            sensor_parameters["bidirectional_range"] = struct.unpack(">H", frame[2:4])
            sensor_parameters["presence_range"] = struct.unpack(">H", frame[6:8])
            sensor_parameters["presence_time"] = struct.unpack(">H", frame[8:10])
            sensor_parameters["engagement_range"] = struct.unpack(">H", frame[12:14])
            sensor_parameters["engagement_time"] = frame[14]
            sensor_parameters["disengagement_time"] = frame[15]
            sensor_parameters["swipe_min"] = struct.unpack(">H", frame[18:20])
            sensor_parameters["swipe_max"] = struct.unpack(">H", frame[20:22])
            sensor_parameters["validation_range"] = struct.unpack(">H", frame[22:24])
            sensor_parameters["validation_time"] = struct.unpack(">H", frame[24:26])

        return sensor_parameters

    def check_ranges(self, range_list):
        for i in range(len(range_list)):
            # Checking error codes
            if range_list[i] == 65535:  # Sensor measuring above its maximum limit
                range_list[i] = float('inf')
            elif range_list[i] == 1:  # Sensor not able to measure
                range_list[i] = float('nan')
            elif range_list[i] == 0:  # Sensor detecting object below minimum range
                range_list[i] = -float('inf')
            else:
                # Convert frame in meters
                range_list[i] /= 1000.0

        return range_list

    def send_command(self, command):
        with self.serial_lock:  # This avoid concurrent writes/reads of serial
            self.port.write(command)
            ack = self.port.read(1)
            # This loop discards buffered frames until an ACK header is reached
            while ack != b"\x12":
                ack = self.port.read(1)
            else:
                ack += self.port.read(3)

            # Check ACK crc8
            crc8 = self.crc8(ack[:3])
            if crc8 == ack[3]:
                # Check if ACK or NACK
                if ack[2] == 0:
                    return True
                else:
                    print("Command not acknowledged")
                    return False
            else:
                print("Error in ACK checksum")
                return False

    def set_bidirectional_mode(self):
        if self.send_command(Evo_Swipe_Plus.BIDIRECTIONAL_MODE):
            print("Bidirectional traffic detection mode set")

    def set_swipe_mode(self):
        if self.send_command(Evo_Swipe_Plus.SWIPE_MODE):
            print("Swipe mode set")

    def set_presence_mode(self):
        if self.send_command(Evo_Swipe_Plus.PRESENCE_MODE):
            print("Traffic Detection mode set")

    def reset_bidirectional_counter(self):
        if self.send_command(Evo_Swipe_Plus.RESET_BIDIRECTIONAL_COUNTER):
            print("Reset Bidirectional counter")

    def reset_detection_counter(self):
        if self.send_command(Evo_Swipe_Plus.RESET_PRESENCE_COUNTER):
            print("Reset Traffic Detection counter")

    def get_sensor_parameters(self):
        if self.send_command(Evo_Swipe_Plus.GET_SENSOR_PARAMETERS):
            print("Get Parameters")
            return self.get_parameters_values()

    def set_bidirectional_range(self, bidirectional_max_limit, bidicretional_min_limit):
        crc8_command_swipe = b"\x00\x55\x03"
        crc8_command_swipe += struct.pack(">H", bidirectional_max_limit)
        crc8_command_swipe += struct.pack(">H", bidicretional_min_limit)
        crc8_command_swipe += bytes(bytearray([self.crc8(crc8_command_swipe)]))
        if self.send_command(crc8_command_swipe):
            print("Changed Bidirectional Limits")

    def set_swipe_min_and_max(self, swipe_max_limit, swipe_min_limit):
        crc8_command_swipe = b"\x00\x55\x04"
        crc8_command_swipe += struct.pack(">H", swipe_max_limit)
        crc8_command_swipe += struct.pack(">H", swipe_min_limit)
        crc8_command_swipe += bytes(bytearray([self.crc8(crc8_command_swipe)]))
        if self.send_command(crc8_command_swipe):
            print("Changed Swipe Limits")

    def set_engagement_params(self, engagement_threshold, engagement_time, disengagement_time):
        crc8_command_engagement = b"\x00\x55\x05"
        crc8_command_engagement += struct.pack(">H", engagement_threshold)
        crc8_command_engagement += struct.pack(">B", engagement_time)
        crc8_command_engagement += struct.pack(">B", disengagement_time)
        crc8_command_engagement += bytes(bytearray([self.crc8(crc8_command_engagement)]))
        if self.send_command(crc8_command_engagement):
            print("Changed Engagement Limits")

    def set_validation_params(self, validation_threshold, validation_time):
        crc8_command_validation = b"\x00\x55\x06"
        crc8_command_validation += struct.pack(">H", validation_threshold)
        crc8_command_validation += struct.pack(">H", validation_time)
        crc8_command_validation += bytes(bytearray([self.crc8(crc8_command_validation)]))
        if self.send_command(crc8_command_validation):
            print("Change Validation Limits")

    def set_presence_params(self, presence_threshold, presence_time):
        crc8_command_presence = b"\x00\x55\x07"
        crc8_command_presence += struct.pack(">H", presence_threshold)
        crc8_command_presence += struct.pack(">H", presence_time)
        crc8_command_presence += bytes(bytearray([self.crc8(crc8_command_presence)]))
        if self.send_command(crc8_command_presence):
            print("Change Traffic Detection Limits")

    def run(self):
        self.port.flushInput()

        while ranges is not None:
            ranges, new_counter_value, movement = self.get_ranges()
        else:
            print("No data from sensor")


if __name__ == '__main__':
    sensor = Evo_Swipe_Plus()
    sensor.run()
