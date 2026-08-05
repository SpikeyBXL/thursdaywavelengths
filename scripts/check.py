#!/usr/bin/env python3
"""
Check data/symptoms.csv and report what is in it.

  python3 scripts/check.py            # summary, warnings and errors
  python3 scripts/check.py --strict   # exit non-zero on warnings too

Nothing is built or written — the page reads the CSV directly in the browser.
Run this after adding a week to confirm the entries landed as you meant them to.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CSV_PATH = ROOT / "data" / "symptoms.csv"
CONFIG_PATH = ROOT / "data" / "config.json"

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
NOTE_RE = re.compile(r"^(?P<name>.+?)\s*\((?P<note>[^()]+)\)\s*$")
WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def fold(text: str) -> str:
    """Normalise a symptom for duplicate detection: accent-, case- and punctuation-blind."""
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = text.lower()
    text = re.sub(r"[^a-z0-9 ]+", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def split_note(item: str) -> tuple[str, str]:
    """'Yousels (vs Measels)' -> ('Yousels', 'vs Measels')"""
    m = NOTE_RE.match(item)
    if m and m.group("name").strip():
        return m.group("name").strip(), m.group("note").strip()
    return item.strip(), ""


def load_config() -> dict:
    cfg = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    cfg.setdefault("title", "Symptom Index")
    cfg.setdefault("subtitle", "")
    cfg.setdefault("blurb", "")
    cfg.setdefault("accession_prefix", "REC")
    cfg.setdefault("expected_weekday", "")
    cfg.setdefault("normalise_capitalisation", True)
    cfg.setdefault("exclude_contains", [])
    cfg.setdefault("repo_url", "")
    cfg.setdefault("footer_note", "")
    return cfg


def load_rows() -> list[dict]:
    with CSV_PATH.open(newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        missing = {"date", "item"} - set(reader.fieldnames or [])
        if missing:
            sys.exit(f"FATAL: {CSV_PATH} is missing column(s): {', '.join(sorted(missing))}")
        return [
            {"date": (r.get("date") or "").strip(),
             "item": (r.get("item") or "").strip(),
             "line": i}
            for i, r in enumerate(reader, start=2)
        ]


def validate(rows: list[dict], cfg: dict) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    expected = cfg.get("expected_weekday", "")

    seen_on_date: dict[tuple[str, str], int] = {}

    for r in rows:
        line, date, item = r["line"], r["date"], r["item"]

        if not item:
            errors.append(f"line {line}: empty symptom")
            continue
        if not DATE_RE.match(date):
            errors.append(f"line {line}: date '{date}' is not YYYY-MM-DD")
            continue
        try:
            dt = datetime.strptime(date, "%Y-%m-%d").date()
        except ValueError:
            errors.append(f"line {line}: '{date}' is not a real date")
            continue

        if dt > datetime.now(timezone.utc).date():
            warnings.append(f"line {line}: {date} is in the future — check the date")
        if expected and WEEKDAYS[dt.weekday()] != expected:
            warnings.append(
                f"line {line}: {date} is a {WEEKDAYS[dt.weekday()]}, not a {expected} — '{item}'"
            )
        if item.count("(") != item.count(")"):
            warnings.append(f"line {line}: unbalanced brackets — '{item}'")

        key = (date, fold(item))
        if key in seen_on_date:
            errors.append(
                f"line {line}: '{item}' already logged on {date} (line {seen_on_date[key]})"
            )
        else:
            seen_on_date[key] = line

    dates = {r["date"] for r in rows if DATE_RE.match(r["date"])}
    if dates:
        counts = Counter(r["date"] for r in rows)
        median = sorted(counts.values())[len(counts) // 2]
        newest = max(dates)
        if counts[newest] < max(3, median // 3):
            warnings.append(
                f"latest session {newest} has only {counts[newest]} entries "
                f"(typical is {median}) — is it complete?"
            )

    return errors, warnings


def canonical_names(rows: list[dict]) -> tuple[dict[str, str], list[str]]:
    """
    Pick one display spelling per symptom.

    'Femur fortune' and 'Femur Fortune' are the same joke typed two ways. The
    winner is the most-used spelling; ties go to the more Title Cased one, then
    to the most recent. Deliberate oddities (McRib, EFD, IntestFun) are left
    alone because nothing else in the file folds to the same key.
    """
    seen: dict[str, dict[str, list]] = defaultdict(dict)
    for r in rows:
        name, _ = split_note(r["item"])
        key = fold(name)
        slot = seen[key].setdefault(name, [0, r["date"]])
        slot[0] += 1
        slot[1] = max(slot[1], r["date"])

    chosen: dict[str, str] = {}
    merges: list[str] = []
    for key, variants in seen.items():
        if len(variants) == 1:
            chosen[key] = next(iter(variants))
            continue
        best = max(
            variants.items(),
            key=lambda kv: (
                kv[1][0],                                            # times used
                sum(1 for w in kv[0].split() if w[:1].isupper()),     # Title Cased words
                kv[1][1],                                            # most recent
            ),
        )[0]
        chosen[key] = best
        others = ", ".join(f"'{v}' ×{c[0]}" for v, c in variants.items() if v != best)
        merges.append(f"'{best}' shown for {others}")
    return chosen, merges


def build_payload(rows: list[dict], cfg: dict) -> tuple[dict, list[str]]:
    patterns = [p.lower() for p in cfg["exclude_contains"] if p.strip()]
    chosen, merges = canonical_names(rows)
    if not cfg.get("normalise_capitalisation", True):
        merges = []

    ordered = sorted(rows, key=lambda r: (r["date"], r["item"].lower()))
    seq: Counter = Counter()
    entries = []
    for r in ordered:
        name, note = split_note(r["item"])
        key = fold(name)
        if cfg.get("normalise_capitalisation", True):
            name = chosen.get(key, name)
        seq[r["date"]] += 1
        low = r["item"].lower()
        entries.append({
            # Date-based, so backfilling an old session never renumbers a newer one.
            "id": f"{cfg['accession_prefix']}-{r['date'].replace('-', '')}-{seq[r['date']]:02d}",
            "date": r["date"],
            "name": name,
            "note": note,
            "raw": r["item"],
            "key": key,
            "excluded": any(p in low for p in patterns),
        })

    kept = [e for e in entries if not e["excluded"]]
    by_key = defaultdict(list)
    for e in kept:
        by_key[e["key"]].append(e)

    dates = sorted({e["date"] for e in kept})
    stats = {
        "records": len(kept),
        "unique": len(by_key),
        "sessions": len(dates),
        "excluded": len(entries) - len(kept),
        "first_session": dates[0] if dates else None,
        "latest_session": dates[-1] if dates else None,
        "repeats": sum(1 for v in by_key.values() if len(v) > 1),
    }

    return {"stats": stats, "entries": entries}, merges


def report(payload: dict, merges: list[str], errors: list[str], warnings: list[str]) -> str:
    s = payload["stats"]
    lines = [
        "## Wavelengths check",
        "",
        f"- **Records** {s['records']:,}  ·  **Unique symptoms** {s['unique']:,}"
        f"  ·  **Sessions** {s['sessions']:,}",
        f"- **Latest session** {s['latest_session']}  ·  "
        f"**First session** {s['first_session']}",
        f"- **Excluded by filter** {s['excluded']}  ·  "
        f"**Symptoms used more than once** {s['repeats']:,}",
        "",
    ]
    latest = [e for e in payload["entries"]
              if e["date"] == s["latest_session"] and not e["excluded"]]
    lines.append(f"### Latest session — {s['latest_session']} ({len(latest)} entries)")
    lines += [f"- {e['raw']}" for e in sorted(latest, key=lambda e: e["name"].lower())]
    lines.append("")
    if merges:
        lines.append(f"### Spellings merged ({len(merges)})")
        lines += [f"- {m}" for m in merges]
        lines.append("")
    if errors:
        lines.append(f"### Errors ({len(errors)})")
        lines += [f"- {e}" for e in errors]
        lines.append("")
    if warnings:
        lines.append(f"### Warnings ({len(warnings)})")
        lines += [f"- {w}" for w in warnings]
        lines.append("")
    if not errors and not warnings:
        lines.append("No problems found.")
    return "\n".join(lines)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--strict", action="store_true", help="exit non-zero on warnings too")
    args = ap.parse_args()

    cfg = load_config()
    rows = load_rows()
    errors, warnings = validate(rows, cfg)
    payload, merges = build_payload(rows, cfg)

    text = report(payload, merges, errors, warnings)
    print(text)

    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as f:
            f.write(text + "\n")

    if errors:
        print(f"\n{len(errors)} error(s) — fix data/symptoms.csv before you push.")
        return 1
    if warnings and args.strict:
        print(f"\n{len(warnings)} warning(s) under --strict.")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
