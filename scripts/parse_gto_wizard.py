"""Parse GTO Wizard "Copy Range" output (PioSolver per-combo format)
into the `build()` map format used in js/ranges.js.

Usage:
    python3 scripts/parse_gto_wizard.py < input.txt

Input format (comma-separated, may span multiple lines):
    2d2c: 0.5,3c2d: 0.25,AhAd: 1,AsKs: 1,AcKd: 0.5,...

Output: ordered build() entries with frequency as 0-100 percent.
"""
import re
import sys

RANK_IDX = {"2": 0, "3": 1, "4": 2, "5": 3, "6": 4, "7": 5, "8": 6,
            "9": 7, "T": 8, "J": 9, "Q": 10, "K": 11, "A": 12}


def classify(combo: str) -> str:
    """4-char combo like 'AsKd' -> hand class like 'AKo'."""
    r1, s1, r2, s2 = combo[0], combo[1], combo[2], combo[3]
    if r1 == r2:
        return r1 + r2
    hi, lo = (r1, r2) if RANK_IDX[r1] > RANK_IDX[r2] else (r2, r1)
    return hi + lo + ("s" if s1 == s2 else "o")


def expected_combos(hand: str) -> int:
    if len(hand) == 2:
        return 6              # pair
    if hand.endswith("s"):
        return 4              # suited
    return 12                 # offsuit


def parse(text: str) -> dict:
    # Split only on commas (entries) — values may have spaces around ":"
    sums = {}
    text = text.replace("\n", ",")
    for piece in text.split(","):
        piece = piece.strip()
        if ":" not in piece:
            continue
        combo, freq_str = piece.split(":", 1)
        combo = combo.strip()
        freq_str = freq_str.strip()
        if len(combo) != 4:
            continue
        try:
            freq = float(freq_str)
        except ValueError:
            continue
        hand = classify(combo)
        sums[hand] = sums.get(hand, 0.0) + freq
    return {h: (s / expected_combos(h)) * 100 for h, s in sums.items()}


def sort_key(h: str):
    """Pairs (high to low), then suited (row by row), then offsuit."""
    if len(h) == 2:
        return (0, -RANK_IDX[h[0]], 0)
    suited = h.endswith("s")
    return (1 if suited else 2, -RANK_IDX[h[0]], -RANK_IDX[h[1]])


def render(parsed: dict) -> tuple[str, float, int]:
    ordered = sorted(parsed.keys(), key=sort_key)
    lines = []
    for h in ordered:
        v = parsed[h]
        # snap near-100 to 100, near-0 we just drop
        if v >= 99.5:
            v_out = 100
        elif v < 0.5:
            continue
        elif abs(v - round(v)) < 0.1:
            v_out = int(round(v))
        else:
            v_out = round(v, 1)
        lines.append(f'  "{h}": {v_out},')
    body = "\n".join(lines)
    total_combos = sum(
        parsed[h] / 100 * expected_combos(h) for h in parsed if parsed[h] >= 0.5
    )
    return body, total_combos / 1326 * 100, len(lines)


if __name__ == "__main__":
    text = sys.stdin.read()
    parsed = parse(text)
    body, pct, n = render(parsed)
    print(f"// {pct:.1f}% range, {n} hand classes")
    print(body)
