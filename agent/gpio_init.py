#!/usr/bin/env python3
import os
import RPi.GPIO as GPIO

GPIO.setmode(GPIO.BCM)
GPIO.setwarnings(False)

# Keypad pins - set as INPUT with appropriate pull
KEYPAD_PINS = [5, 6, 16, 22, 23, 24, 25, 26, 27]

active_low = os.getenv('ACTIVE_LOW', '1') == '1'
idle_pud = GPIO.PUD_UP if active_low else GPIO.PUD_DOWN

for pin in KEYPAD_PINS:
    GPIO.setup(pin, GPIO.IN, pull_up_down=idle_pud)

# Door sensor - GPIO12 with pull-up (door closed = LOW when magnet activates reed switch)
DOOR_GPIO = 12
GPIO.setup(DOOR_GPIO, GPIO.IN, pull_up_down=GPIO.PUD_UP)

# Relay GPIO - set as OUTPUT, initially LOW
RELAY_GPIO = 4
GPIO.setup(RELAY_GPIO, GPIO.OUT, initial=GPIO.LOW)

# Drop sensor - GPIO17 with pull-up
DROP_GPIO = 17
GPIO.setup(DROP_GPIO, GPIO.IN, pull_up_down=GPIO.PUD_UP)

pud_name = 'PUD_UP' if idle_pud == GPIO.PUD_UP else 'PUD_DOWN'
print(f'[GPIO_INIT] Done - keypad pins: INPUT {pud_name}, door GPIO12: INPUT PUD_UP, relay GPIO4: OUTPUT, drop GPIO17: INPUT PUD_UP')
