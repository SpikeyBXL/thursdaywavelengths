#!/usr/bin/env python3
"""
Add entries to data/symptoms.csv, with a confirmation step.

  python3 scripts/add_entries.py                 # type/paste, Ctrl-D when done
  python3 scripts/add_entries.py -f backlog.txt  # read from a file
  python3 scripts/add_entries.py -d 2024-02-15   # set the session date
  python3 scripts/add_entries.py -y              # skip the confirmation prompt

One symptom per line. Blank lines and lines starting with # are ignored.
Without a date, entries go to the most recent Thursday.

To catch up on old shows, put a bare date on its own line and every symptom
under it belongs to that session — as many sessions per run as you like:

    2024-02-15
    Gout Of Order
    Spleenwheel

    2024-02-22
    Rotator Cuffalo

Backfilling never disturbs existing records: the file is re-sorted by date and
accession numbers are derived from the session date, not from row position.
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
from collections import OrderedDict
from datetime import date, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from check import CSV_PATH, WEEKDAYS, fold, load_config, split_note  # noqa: E402

DATE_LINE = re.compile(r"^(?:#+\s*|session\s+)?(\d{4}-\d{2}-\d{2})\s*[:.]?$", re.I)


def most_recent(weekday_name: str, today: date) -> date:
    if weekday_name not in WEEKDAYS:
        return today
    target = WEEKDAYS.index(weekday_name)
    return today - timedelta(days=(today.weekday() - target) % 7)


def err(msg: str) -> int:
    print(msg, file=sys.stderr)
    return 1


def parse(text: str, default_session: str) -> tuple[OrderedDict, list[str]]:
    """Split input into {session date: [symptoms]}, honouring bare date lines."""
    batches: OrderedDict[str, list[str]] = OrderedDict()
    problems: list[str] = []
    current = default_session

    for raw in text.splitlines():
        line = raw.strip().lstrip("-•*").strip()
        if not line:
            continue

        m = DATE_LINE.match(line)
        if m:
            try:
                datetime.strptime(m.group(1), "%Y-%m-%d")
            except ValueError:
                problems.append(f"'{m.group(1)}' is not a real date")
                continue
            current = m.group(1)
            batches.setdefault(current, [])
            continue

        if line.startswith("#"):
            continue
        batches.setdefault(current, []).append(line)

    return batches, problems


def main() -> int:
    cfg = load_config()
    expected = cfg.get("expected_weekday", "")

    ap = argparse.ArgumentParser()
    ap.add_argument("-d", "--date", help="session date for entries with no date line")
    ap.add_argument("-f", "--file", help="file with one symptom per line")
    ap.add_argument("-y", "--yes", action="store_true", help="skip confirmation")
    args = ap.parse_args()

    if args.date:
        try:
            default = datetime.strptime(args.date, "%Y-%m-%d").date()
        except ValueError:
            return err(f"'{args.date}' is not a date in YYYY-MM-DD form.")
    else:
        default = most_recent(expected, date.today())

    if args.file:
        text = Path(args.file).read_text(encoding="utf-8")
    else:
        if sys.stdin.isatty():
            print(f"Symptoms for {default} ({WEEKDAYS[default.weekday()]}), one per line.")
            print("Start a line with a bare date to switch sessions. Ctrl-D when done.\n")
        text = sys.stdin.read()

    batches, problems = parse(text, default.isoformat())
    for p in problems:
        print(f"  ignored: {p}", file=sys.stderr)
    batches = OrderedDict((d, v) for d, v in batches.items() if v)
    if not batches:
        return err("No symptoms given — nothing to add.")

    with CSV_PATH.open(newline="", encoding="utf-8-sig") as f:
        existing = [{"date": r["date"].strip(), "item": r["item"].strip()}
                    for r in csv.DictReader(f)]

    by_date: dict[str, set] = {}
    ever: dict[str, list] = {}
    for r in existing:
        by_date.setdefault(r["date"], set()).add(fold(r["item"]))
        ever.setdefault(fold(r["item"]), []).append(r["date"])

    planned: OrderedDict[str, list[str]] = OrderedDict()
    skipped: list[str] = []
    total = 0

    for session in sorted(batches):
        already = by_date.get(session, set())
        seen: set = set()
        keep: list[str] = []
        for item in batches[session]:
            k = fold(item)
            if k in already or k in seen:
                skipped.append(f"{session}  {item} — already logged that day")
                continue
            seen.add(k)
            keep.append(item)
        if keep:
            planned[session] = sorted(keep, key=str.lower)
            total += len(keep)
            # so a symptom repeated across two sessions in one run gets flagged too
            for item in keep:
                ever.setdefault(fold(item), []).append(session)

    if not planned:
        for s in skipped:
            print(f"  [skipped] {s}")
        return err("\nEverything is already logged. Nothing to add.")

    for session, items in planned.items():
        d = datetime.strptime(session, "%Y-%m-%d").date()
        existing_count = len(by_date.get(session, ()))
        status = (f"adding to an existing session of {existing_count}"
                  if existing_count else "new session")
        flags = []
        if expected and WEEKDAYS[d.weekday()] != expected:
            flags.append(f"a {WEEKDAYS[d.weekday()]}, not a {expected}")
        if d > date.today():
            flags.append("in the future")
        note = f"  [{'; '.join(flags)}]" if flags else ""

        print(f"\n  {session}  ({WEEKDAYS[d.weekday()]})  {len(items)} entries "
              f"— {status}{note}")
        for item in items:
            name, sub = split_note(item)
            prior = [p for p in ever.get(fold(item), []) if p != session]
            seen_before = ""
            if prior:
                seen_before = f"    ← used before, last on {max(prior)}"
                if len(prior) > 1:
                    seen_before += f" (+{len(prior) - 1} more)"
            print(f"      {name}" + (f"  ({sub})" if sub else "") + seen_before)

    for s in skipped:
        print(f"\n  [skipped] {s}")

    label = f"{total} entries across {len(planned)} sessions" if len(planned) > 1 \
        else f"{total} entries"
    if not args.yes:
        try:
            answer = input(f"\nWrite {label} to {CSV_PATH.name}? [y/N] ").strip().lower()
        except (EOFError, KeyboardInterrupt):
            print()
            return err("Cancelled. Nothing written.")
        if answer not in ("y", "yes"):
            return err("Cancelled. Nothing written.")

    rows = existing + [{"date": d, "item": i}
                       for d, items in planned.items() for i in items]
    rows.sort(key=lambda r: r["item"].lower())
    rows.sort(key=lambda r: r["date"], reverse=True)
    with CSV_PATH.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["date", "item"], lineterminator="\n")
        w.writeheader()
        w.writerows(rows)

    print(f"\nWrote {label}. {CSV_PATH.name} now holds {len(rows)} rows.")
    print("Next:  python3 scripts/check.py   then commit and push.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
