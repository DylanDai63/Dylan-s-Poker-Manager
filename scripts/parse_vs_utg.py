"""Merge a raise + call range pair (vs UTG defense) into [r, c] build() entries.

Usage:
    python3 scripts/parse_vs_utg.py <raise_file> <call_file>
"""
import sys
sys.path.insert(0, "scripts")
from parse_gto_wizard import parse

RANK_IDX = {"2":0, "3":1, "4":2, "5":3, "6":4, "7":5, "8":6,
            "9":7, "T":8, "J":9, "Q":10, "K":11, "A":12}


def sort_key(h):
    if len(h) == 2:
        return (0, -RANK_IDX[h[0]], 0)
    suited = h.endswith("s")
    return (1 if suited else 2, -RANK_IDX[h[0]], -RANK_IDX[h[1]])


def fmt(v):
    if v >= 99.5:
        return "100"
    if v == int(v):
        return str(int(v))
    return f"{v:.1f}"


def main():
    raise_file, call_file = sys.argv[1], sys.argv[2]
    with open(raise_file) as f:
        raise_pct = parse(f.read())
    with open(call_file) as f:
        call_pct = parse(f.read())

    all_hands = sorted(set(raise_pct) | set(call_pct), key=sort_key)
    total_r = total_c = 0.0
    emitted = 0
    lines = []
    for h in all_hands:
        r = raise_pct.get(h, 0.0)
        c = call_pct.get(h, 0.0)
        if r < 0.5 and c < 0.5:
            continue
        if r >= 99.5: r = 100
        if c >= 99.5: c = 100
        multi = 6 if len(h) == 2 else (4 if h.endswith("s") else 12)
        total_r += r / 100 * multi
        total_c += c / 100 * multi
        emitted += 1
        lines.append(f'  "{h}": [{fmt(r)}, {fmt(c)}],')

    print(f"// 3-bet {total_r/1326*100:.1f}% + call {total_c/1326*100:.1f}% "
          f"= {(total_r+total_c)/1326*100:.1f}% defended, {emitted} hands")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
