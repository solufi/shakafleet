#!/usr/bin/env python3
import RPi.GPIO as GPIO
import time
import argparse

GPIO.setmode(GPIO.BCM)
GPIO.setwarnings(False)

# Keypad pins (BCM) used for AMS keypad emulation
ALLOWED_PINS = [5, 6, 16, 22, 23, 24, 25, 26, 27]

PRESS_S = 0.15
BETWEEN_S = 0.25

# ⚠️ Si rien ne se passe, lance avec --active-low
RELAY_ACTIVE_HIGH = True
ACTIVE = GPIO.HIGH if RELAY_ACTIVE_HIGH else GPIO.LOW
INACTIVE = GPIO.LOW if RELAY_ACTIVE_HIGH else GPIO.HIGH


# ============================================================
# DROP SENSOR (optique) - basé sur le script Node fonctionnel
# Node: new Gpio(17, 'in', 'falling')
# => BCM 17 / FALLING / timeout 10s / retry 1
# ============================================================
DROP_GPIO_DEFAULT = 17
DROP_EDGE_DEFAULT = "FALLING"
DROP_TIMEOUT_DEFAULT = 10.0
DROP_BOUNCE_MS_DEFAULT = 40

# ============================================================
# RELAY GPIO for direct product control
# ============================================================
RELAY_GPIO = 4
RELAY_TRIGGER_DURATION = 0.7  # 700ms for 3.3V relay

# ============================================================
# DOOR SENSOR (magnetic reed switch) - GPIO12 with pull-up
# Avec PUD_UP: porte ouverte (aimant loin)  → GPIO = HIGH (1)
#              porte fermée (aimant proche) → GPIO = LOW (0)
# ============================================================
DOOR_GPIO = 12
DOOR_OPEN_STATE = GPIO.HIGH  # HIGH (1) when door is open
DOOR_CLOSED_STATE = GPIO.LOW # LOW (0) when door is closed

# Vérifier automatiquement le drop après CHAQUE --seq / séquence interactive
AUTO_DROP_ON_SEQ_DEFAULT = True

_drop_enabled = False
_drop_gpio = None
_drop_timeout_s = DROP_TIMEOUT_DEFAULT

# Door monitoring state
_door_enabled = False
_door_monitoring = False


# ✅ MAPPING FINAL (confirmé) - timing 100ms
KEYMAP = {
    "1": (24, 25),
    "2": (5, 24),
    "3": (22, 25),
    "4": (5, 22),
    "5": (23, 25),
    "6": (5, 23),
    "7": (25, 27),
    "8": (5, 27),
    "9": (25, 6),
    "0": (5, 6),

    "*": (26, 6),
    "#": (16, 6),
}


def gpio_init(active_low: bool):
    global ACTIVE, INACTIVE
    if active_low:
        ACTIVE = GPIO.LOW
        INACTIVE = GPIO.HIGH

    # Configure keypad pins as OUTPUT (not INPUT!)
    for p in ALLOWED_PINS:
        GPIO.setup(p, GPIO.OUT)
        GPIO.output(p, INACTIVE)
    
    # Initialize relay GPIO
    GPIO.setup(RELAY_GPIO, GPIO.OUT)
    GPIO.output(RELAY_GPIO, INACTIVE)  # Relay OFF by default
    
    # Initialize door sensor GPIO with pull-up
    GPIO.setup(DOOR_GPIO, GPIO.IN, pull_up_down=GPIO.PUD_UP)


# ---------------- DROP SENSOR ----------------

def setup_drop_sensor(drop_gpio, edge: str, bounce_ms: int):
    """
    Active la lecture drop si drop_gpio est défini.
    SAFE: si problème, drop est désactivé sans casser le keypad.
    """
    global _drop_enabled, _drop_gpio

    _drop_enabled = False
    _drop_gpio = None

    if drop_gpio is None:
        print("[DROP] Disabled (no GPIO provided)")
        return

    try:
        drop_gpio = int(drop_gpio)

        # Prevent conflicts with keypad pins
        if drop_gpio in ALLOWED_PINS:
            print(f"[DROP] Disabled: BCM {drop_gpio} conflicts with keypad pins {ALLOWED_PINS}")
            return

        # Default pull-up (typique: pulse LOW quand item tombe)
        GPIO.setup(drop_gpio, GPIO.IN, pull_up_down=GPIO.PUD_UP)

        e = (edge or "FALLING").upper()
        gpio_edge = GPIO.FALLING if e == "FALLING" else GPIO.RISING

        GPIO.add_event_detect(drop_gpio, gpio_edge, bouncetime=int(bounce_ms))

        _drop_enabled = True
        _drop_gpio = drop_gpio
        print(f"[DROP] Enabled on BCM {_drop_gpio} ({e})")

    except Exception as ex:
        print(f"[DROP] Disabled (setup error): {ex}")
        _drop_enabled = False
        _drop_gpio = None


def trigger_relay():
    """
    Déclenche le relais GPIO4 pendant 700ms pour contrôle direct du produit
    """
    print(f"🔌 Triggering relay GPIO {RELAY_GPIO} for {RELAY_TRIGGER_DURATION}s")
    GPIO.output(RELAY_GPIO, ACTIVE)
    time.sleep(RELAY_TRIGGER_DURATION)
    GPIO.output(RELAY_GPIO, INACTIVE)
    print(f"✅ Relay trigger completed")


def is_door_open() -> bool:
    """
    Vérifie si la porte est ouverte
    Returns True si porte ouverte, False si fermée
    """
    try:
        return GPIO.input(DOOR_GPIO) == DOOR_OPEN_STATE
    except:
        return False  # Safe default


def setup_door_monitoring(enabled: bool = True):
    """
    Active/désactive le monitoring de la porte
    """
    global _door_enabled, _door_monitoring
    _door_enabled = enabled
    _door_monitoring = enabled
    print(f"[DOOR] Monitoring {'enabled' if enabled else 'disabled'} on GPIO {DOOR_GPIO}")


def check_door_status():
    """
    Affiche le statut de la porte si monitoring est activé
    """
    if not _door_monitoring:
        return
    
    if is_door_open():
        print("⚠️  PORTE OUVERTE - Veuillez fermer la porte du haut!")
    else:
        print("✅ Porte fermée")


def wait_for_drop(timeout_s: float = None) -> bool:
    """
    Attend un pulse drop optique.
    Retourne True si détecté avant timeout, sinon False.
    Si drop non activé -> False (safe).
    """
    global _drop_timeout_s
    if timeout_s is None:
        timeout_s = _drop_timeout_s

    if not _drop_enabled or _drop_gpio is None:
        return False

    start = time.time()
    while (time.time() - start) < float(timeout_s):
        if GPIO.event_detected(_drop_gpio):
            return True
        time.sleep(0.01)
    return False


def send_sequence_and_validate_drop(seq: str, retries: int, timeout_s: float) -> bool:
    """
    Envoie la séquence puis attend un drop.
    Retry comme le script Node (default retries=1).
    """
    for attempt in range(retries + 1):
        print(f"[SEQ] attempt {attempt+1}/{retries+1}: sending '{seq}'")
        press_sequence(seq)

        # Si drop désactivé, on ne bloque pas: on considère "unknown", mais on ne fail pas le keypad.
        if not _drop_enabled:
            print("[DROP] Disabled -> skip validation (keypad only)")
            return True

        print(f"[DROP] waiting (timeout {timeout_s}s)...")
        if wait_for_drop(timeout_s):
            print("✅ DROP DETECTED")
            return True

        print("❌ NO DROP (timeout)")

    return False


# ---------------- KEYPAD ----------------

def press_pair(a: int, b: int, label: str = ""):
    print(f"PRESS {label} -> GPIO {a}+{b}")
    GPIO.output(a, ACTIVE)
    GPIO.output(b, ACTIVE)
    time.sleep(PRESS_S)
    GPIO.output(a, INACTIVE)
    GPIO.output(b, INACTIVE)
    time.sleep(BETWEEN_S)


def press_key(k: str):
    if k not in KEYMAP:
        raise ValueError(f"Touche inconnue '{k}'. Disponibles: {''.join(KEYMAP.keys())}")
    a, b = KEYMAP[k]
    press_pair(a, b, k)


def press_sequence(seq: str):
    for ch in seq:
        if ch in (" ", "-", "_"):
            continue
        press_key(ch)


def interactive_mode(retries: int = 1, timeout_s: float = None, auto_drop_on_seq: bool = True):
    print("\n=== MODE INTERACTIF ===")
    print("Entrez une touche (1-9,0,*,#) ou une séquence (ex: 1230#)")
    print("Commandes: 'q' pour quitter, 'map' pour KEYMAP, 'drop?' pour test drop, 'door?' pour porte")
    
    if not auto_drop_on_seq:
        print("[AUTO] Drop validation OFF for sequences\n")

    while True:
        # Check door status before each input if monitoring enabled
        check_door_status()
        
        s = input("> ").strip()
        if not s:
            continue
        if s.lower() in ("q", "quit", "exit"):
            break
        if s.lower() == "map":
            for k, (a, b) in KEYMAP.items():
                print(f"  {k} -> {a}+{b}")
            continue
        if s.lower() == "drop?":
            ok = wait_for_drop(timeout_s)
            print("✅ DROP DETECTED" if ok else "❌ NO DROP (timeout or disabled)")
            continue
        if s.lower() == "door?":
            print("🚪 Porte OUVERTE" if is_door_open() else "✅ Porte fermée")
            continue

        try:
            # Si c'est une seule touche
            if len(s) == 1 and s in KEYMAP:
                press_key(s)
            else:
                # Séquence: validation drop automatique si activée
                if auto_drop_on_seq:
                    ok = send_sequence_and_validate_drop(s, retries=retries, timeout_s=timeout_s)
                    print("DONE:", "SUCCESS" if ok else "FAIL")
                else:
                    press_sequence(s)
        except Exception as e:
            print(f"Erreur: {e}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--key", help="Appuie une seule touche: 0-9, *, #")
    ap.add_argument("--seq", help="Appuie une séquence, ex: 1230#")
    ap.add_argument("--relay", action="store_true", help="Déclenche le relais GPIO4 pendant 700ms")
    ap.add_argument("--door", action="store_true", help="Vérifie le statut de la porte")
    ap.add_argument("--door-monitoring", action="store_true", help="Active le monitoring de la porte")
    ap.add_argument("--active-low", action="store_true", help="Si ton montage est actif LOW")
    ap.add_argument("--press-ms", type=int, default=None, help="Override durée appui en ms")
    ap.add_argument("--between-ms", type=int, default=None, help="Override pause entre touches en ms")

    # Drop options
    ap.add_argument("--drop-gpio", type=int, default=DROP_GPIO_DEFAULT,
                    help="GPIO BCM INPUT pour drop optique (default: 17)")
    ap.add_argument("--drop-edge", type=str, default=DROP_EDGE_DEFAULT,
                    help="Edge drop: FALLING ou RISING (default: FALLING)")
    ap.add_argument("--drop-timeout", type=float, default=DROP_TIMEOUT_DEFAULT,
                    help="Timeout attente drop en secondes (default: 10)")
    ap.add_argument("--drop-bounce-ms", type=int, default=DROP_BOUNCE_MS_DEFAULT,
                    help="Debounce drop en ms (default: 40)")
    ap.add_argument("--drop-retries", type=int, default=1,
                    help="Nombre de retries si pas de drop (default: 1, comme Node)")

    # New behavior: validate drop after every --seq by default
    ap.add_argument("--auto-drop-on-seq", action="store_true", default=AUTO_DROP_ON_SEQ_DEFAULT,
                    help="Active la validation drop après chaque séquence (default: ON)")
    ap.add_argument("--no-auto-drop-on-seq", action="store_true",
                    help="Désactive la validation drop après chaque séquence")
    ap.add_argument("--init-only", action="store_true", help="Init GPIO and exit")

    args = ap.parse_args()

    global PRESS_S, BETWEEN_S, _drop_timeout_s
    if args.press_ms is not None:
        PRESS_S = max(0.01, args.press_ms / 1000.0)
    if args.between_ms is not None:
        BETWEEN_S = max(0.01, args.between_ms / 1000.0)

    _drop_timeout_s = float(args.drop_timeout)

    auto_drop_on_seq = args.auto_drop_on_seq and (not args.no_auto_drop_on_seq)

    try:
        gpio_init(args.active_low)
        if args.init_only:
            print("DONE: INIT")
            return

        setup_drop_sensor(args.drop_gpio, args.drop_edge, args.drop_bounce_ms)

        # CLI modes
        if args.door:
            print("🚪 Porte OUVERTE" if is_door_open() else "✅ Porte fermée")
            return

        if args.door_monitoring:
            setup_door_monitoring(True)
            print("Monitoring de porte activé. Utilisez 'door?' en mode interactif pour vérifier.")
            return

        if args.relay:
            trigger_relay()
            return

        if args.key:
            press_key(args.key)
            return

        if args.seq:
            if auto_drop_on_seq:
                ok = send_sequence_and_validate_drop(args.seq, retries=args.drop_retries, timeout_s=_drop_timeout_s)
                print("DONE:", "SUCCESS" if ok else "FAIL")
            else:
                press_sequence(args.seq)
            return

        # Default: interactive
        interactive_loop(auto_drop_on_seq=auto_drop_on_seq, retries=args.drop_retries, timeout_s=_drop_timeout_s)

    finally:
        GPIO.cleanup()
        print("GPIO cleaned up")


if __name__ == "__main__":
    main()
