# Compendium of Wavelengths Symptoms

A searchable catalogue of coined afflictions, published with GitHub Pages.
`data/symptoms.csv` is the only file you edit week to week. The page reads that
CSV directly in the browser, so there is no build step and nothing to deploy —
GitHub serves the repository exactly as it is.

```
index.html             the page
assets/                style.css, app.js
data/symptoms.csv      the data — one row per symptom
data/config.json       title, blurb, exclusion rules
scripts/check.py       reports what is in the CSV and flags anything odd
scripts/add_entries.py adds entries, with a confirmation step
.nojekyll              tells GitHub to serve the files untouched
```

## One-time setup

1. Push these files to the `main` branch of your repository.
2. **Settings → Pages → Build and deployment.** Set **Source** to
   *Deploy from a branch*, then **Branch: `main`** and **folder: `/ (root)`**.
   Save.
3. Wait a minute, then load your Pages URL. The counts should fill in.
4. Optional: put your repository URL into `repo_url` in `data/config.json` for
   a source link in the footer.

That's the whole deployment. Every later push to `main` republishes
automatically within a minute or so.

If the page sits on "Could not load the data", the usual cause is that the
`data` folder didn't get uploaded, or that step 2 points at the wrong folder.

## The weekly update

### Option A — in the browser, no tools needed

1. Open `data/symptoms.csv` on GitHub and click the pencil icon.
2. Add this week's lines under the header row, as `YYYY-MM-DD,Symptom`.
   If a symptom contains a comma, wrap it in double quotes:
   `2025-03-06,"Intestine 1,2,3"`.
3. Commit. Reload the site a minute later — hard-refresh (Ctrl+Shift+R, or
   Cmd+Shift+R on a Mac) if the old numbers are still showing.

### Option B — locally, with a confirmation prompt before anything is written

```bash
python3 scripts/add_entries.py
# paste one symptom per line, Ctrl-D when done
```

It defaults to the most recent Thursday, sorts and de-duplicates the batch,
flags any symptom that has been used before and when, then asks before writing.
Commas are quoted for you.

```bash
python3 scripts/add_entries.py -d 2026-08-13 -f week.txt   # explicit date, from a file
python3 scripts/check.py                                   # report on the whole file
python3 -m http.server 8000                                # preview at localhost:8000
```

### Catching up on old shows

The date you type on has nothing to do with the date an entry belongs to. Put a
bare date on its own line and everything under it joins that session — as many
sessions in one go as you have backlog for:

```
2024-02-15
Gout Of Order
Spleenwheel

2024-02-22
Rotator Cuffalo
```

```bash
python3 scripts/add_entries.py -f backlog.txt
```

Each session is reported separately before you confirm, saying whether it is new
or is being added to a session that already has entries, and flagging any date
that isn't a Thursday. Backfilling is safe to repeat: anything already logged
for that day is skipped rather than duplicated.

Old sessions never take over the front page — the page opens on the latest
session by date, not by when you typed it.

## Checking the data

`python3 scripts/check.py` prints the totals, lists every entry in the latest
session, and warns about anything that looks wrong: a date that isn't a
Thursday, a symptom logged twice on the same day, unbalanced brackets, a future
date, a latest session that looks unusually short. It writes nothing.

`.github/workflows/check.yml` runs the same script on every push and posts the
result to the **Actions** tab, so you get that summary without installing
anything. It is entirely optional — publishing does not depend on it. Delete
the `.github` folder if you don't want it.

## Coverage

The strip under the random specimen shows one tick per week from the earliest
record to the latest, in three states: a session with symptoms, a session
logged with none (a guest host, or the 2017 origin note), and a week with no
record at all. Clicking a logged week filters the table to it; hovering an
amber one shows what that session's entry actually said.

Weeks are keyed by the Thursday they contain, so a session that happened on the
wrong day still lands in its own week rather than vanishing.

It is a to-do list as much as a chart: right now it reads 112 of 486 weeks,
with 2017 to early 2024 almost entirely blank and three real gaps in the
tracked run — the weeks of 27 November 2025, 25 December 2025 and 1 January
2026.

## Exclusions

Some rows aren't symptoms — `First ever Wavelengths. No symptoms mentioned`,
`DJ Perro Caliente fills in`. Any entry whose text contains one of the terms in
`exclude_contains` (in `data/config.json`) is kept in the CSV but left out of
the counts, the table and the random draw:

```json
"exclude_contains": ["no symptoms mentioned", "fills in"]
```

Matching is case-insensitive and matches anywhere in the entry. Excluded rows
are never lost — the **Session notes & exclusions** panel lists every one of
them with its date, so you can always see which DJ filled in or why a week ran
without symptoms. Clicking one pulls it up in the table. Hovering an amber week
on the coverage strip shows the same text.

The panel also lets you try extra exclusion terms without editing anything —
those apply to your browser only and travel in the URL, so you can see what a
rule would do before committing to it.

## Data format

```csv
date,item
2026-07-30,April Drools
2026-07-30,Yousels (vs Measels)
2025-03-06,"Intestine 1,2,3"
```

A trailing parenthetical becomes a note, shown after an em dash and included in
search.

Each record carries an accession number built from its session date —
`WVL-20260730-04` is the fourth entry, alphabetically, of the 30 July 2026
session. It appears on the random specimen rather than in the table, to keep
the table quiet. Backfilling a 2023 show leaves every other number untouched.

Where the same symptom has been typed two ways, the page shows one spelling:
the one used most often, breaking ties towards Title Case and then towards the
most recent. `Femur fortune` and `Femur Fortune` both display as **Femur
Fortune**. The CSV keeps whatever you actually typed, and `check.py` lists
every merge it made. Set `normalise_capitalisation` to `false` in
`data/config.json` to switch this off.

## Notes

- Calibri is used where it's installed; the stack falls back to Carlito (the
  metric-identical open substitute), then Segoe UI, then the system sans. No
  webfont is loaded, so the page makes no external requests at all.
- "Last updated" in the footer comes from the CSV file's own modification date,
  which GitHub sets when you commit.
- Dark mode follows the operating system setting.
- Press `/` to jump to the search box, `Esc` to clear it.
- Sorting, searching and exclusions are stored in the URL, so any view can be
  linked or bookmarked.
