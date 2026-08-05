/* Wavelengths Symptom Index — no dependencies, no build step. */
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };

  var DATA = null;          // payload from symptoms.json
  var ROWS = [];            // all entries, with derived fields
  var state = {
    q: "",
    sort: "name",           // "name" | "date"
    dir: 1,                 // 1 asc, -1 desc
    scope: "latest",        // "latest" | "all"
    extra: [],              // ad-hoc exclusion terms
    showExcluded: false
  };

  /* ---------- helpers ---------- */

  function fold(s) {
    return s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  }

  function esc(s) {
    return s.replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function num(n) { return n.toLocaleString("en-GB"); }

  function longDate(iso) {
    var d = new Date(iso + "T00:00:00Z");
    if (isNaN(d)) return iso;
    return d.toLocaleDateString("en-GB", {
      day: "numeric", month: "long", year: "numeric", timeZone: "UTC"
    });
  }

  function cmp(a, b) {
    return a.localeCompare(b, "en", { sensitivity: "base", numeric: true });
  }

  /* ---------- exclusions ---------- */

  function isExcluded(row) {
    if (row.excluded) return true;
    for (var i = 0; i < state.extra.length; i++) {
      if (row.haystack.indexOf(state.extra[i]) !== -1) return true;
    }
    return false;
  }

  var cache = { sig: null, rows: null, stats: null };

  function signature() { return state.extra.join("\u0000"); }

  function activeRows() {
    if (cache.sig !== signature()) refresh();
    return cache.rows;
  }

  function refresh() {
    cache.sig = signature();
    cache.rows = ROWS.filter(function (r) { return !isExcluded(r); });
    var keys = Object.create(null), dates = Object.create(null);
    cache.rows.forEach(function (r) { keys[r.key] = 1; dates[r.date] = 1; });
    var ds = Object.keys(dates).sort();
    cache.stats = {
      records: cache.rows.length,
      unique: Object.keys(keys).length,
      sessions: ds.length,
      first: ds[0],
      latest: ds[ds.length - 1],
      excluded: ROWS.length - cache.rows.length
    };
  }

  /* ---------- search ---------- */

  function terms() {
    return fold(state.q).split(/\s+/).filter(Boolean);
  }

  function matches(row, ts) {
    for (var i = 0; i < ts.length; i++) {
      if (row.haystack.indexOf(ts[i]) === -1) return false;
    }
    return true;
  }

  function highlight(text, ts) {
    var out = esc(text);
    if (!ts.length) return out;
    var pattern = ts
      .slice()
      .sort(function (a, b) { return b.length - a.length; })
      .map(function (t) { return t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); })
      .join("|");
    // Match on the folded string, then splice marks into the original.
    var folded = fold(out);
    var re = new RegExp(pattern, "g");
    var pieces = [];
    var last = 0;
    var m;
    while ((m = re.exec(folded)) !== null) {
      if (m.index < last) continue;
      pieces.push(out.slice(last, m.index), "<mark>",
                  out.slice(m.index, m.index + m[0].length), "</mark>");
      last = m.index + m[0].length;
      if (m[0].length === 0) re.lastIndex++;
    }
    pieces.push(out.slice(last));
    return pieces.join("");
  }

  /* ---------- derived counts ---------- */

  function stats() {
    if (cache.sig !== signature()) refresh();
    return cache.stats;
  }

  /* ---------- reading the CSV ---------- */

  function parseCSV(text) {
    var rows = [], row = [], field = "", quoted = false, i = 0;
    text = text.replace(/^\uFEFF/, "");
    while (i < text.length) {
      var c = text.charAt(i);
      if (quoted) {
        if (c === '"') {
          if (text.charAt(i + 1) === '"') { field += '"'; i += 2; continue; }
          quoted = false; i++; continue;
        }
        field += c; i++; continue;
      }
      if (c === '"') { quoted = true; i++; continue; }
      if (c === ",") { row.push(field); field = ""; i++; continue; }
      if (c === "\r") { i++; continue; }
      if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
      field += c; i++;
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows;
  }

  // Identity key: accent-, case- and punctuation-blind, so 'Femur fortune'
  // and 'Femur Fortune' are recognised as the same symptom.
  function foldKey(s) {
    return s.normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function splitNote(item) {
    var m = /^(.+?)\s*\(([^()]+)\)\s*$/.exec(item);
    return (m && m[1].trim()) ? [m[1].trim(), m[2].trim()] : [item.trim(), ""];
  }

  // One display spelling per symptom: most used, ties to Title Case, then to
  // the most recent. Deliberate oddities (McRib, EFD) fold to unique keys and
  // are never touched.
  function canonicalNames(records) {
    var seen = Object.create(null);
    records.forEach(function (r) {
      var name = splitNote(r.item)[0];
      var key = foldKey(name);
      var bucket = seen[key] || (seen[key] = Object.create(null));
      var slot = bucket[name] || (bucket[name] = { n: 0, last: "" });
      slot.n++;
      if (r.date > slot.last) slot.last = r.date;
    });

    var chosen = Object.create(null);
    Object.keys(seen).forEach(function (key) {
      var variants = Object.keys(seen[key]);
      chosen[key] = variants.length === 1 ? variants[0] : variants.sort(function (a, b) {
        var A = seen[key][a], B = seen[key][b];
        return (B.n - A.n) || (caps(b) - caps(a)) || (B.last < A.last ? -1 : 1);
      })[0];
    });
    return chosen;
  }

  function caps(s) {
    return s.split(/\s+/).filter(function (w) {
      return w.charAt(0) === w.charAt(0).toUpperCase() && /[a-z]/i.test(w.charAt(0));
    }).length;
  }

  function buildEntries(csvText, cfg) {
    var rows = parseCSV(csvText);
    if (!rows.length) return [];
    var head = rows[0].map(function (h) { return h.trim().toLowerCase(); });
    var di = head.indexOf("date"), ii = head.indexOf("item");
    if (di < 0 || ii < 0) throw new Error("symptoms.csv needs 'date' and 'item' columns");

    var records = [];
    for (var i = 1; i < rows.length; i++) {
      var date = (rows[i][di] || "").trim();
      var item = (rows[i][ii] || "").trim();
      if (date && item) records.push({ date: date, item: item });
    }

    var chosen = canonicalNames(records);
    var normalise = cfg.normalise_capitalisation !== false;
    var patterns = (cfg.exclude_contains || []).map(function (p) {
      return p.toLowerCase();
    }).filter(Boolean);

    records.sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      var x = a.item.toLowerCase(), y = b.item.toLowerCase();
      return x < y ? -1 : x > y ? 1 : 0;
    });

    var seq = Object.create(null);
    var prefix = cfg.accession_prefix || "REC";
    return records.map(function (r) {
      var parts = splitNote(r.item);
      var key = foldKey(parts[0]);
      var low = r.item.toLowerCase();
      seq[r.date] = (seq[r.date] || 0) + 1;
      return {
        // Date-based, so backfilling an old session never renumbers a newer one.
        id: prefix + "-" + r.date.replace(/-/g, "") + "-" +
            (seq[r.date] < 10 ? "0" : "") + seq[r.date],
        date: r.date,
        name: normalise ? (chosen[key] || parts[0]) : parts[0],
        note: parts[1],
        raw: r.item,
        key: key,
        excluded: patterns.some(function (p) { return low.indexOf(p) !== -1; })
      };
    });
  }

  /* ---------- coverage ---------- */

  var DAY = 86400000;
  var covSig = null;

  function thursdayOf(iso) {
    var d = new Date(iso + "T00:00:00Z");
    var mondayIndex = (d.getUTCDay() + 6) % 7;
    return new Date(d.getTime() + (3 - mondayIndex) * DAY);
  }

  function isoWeek(thu) {
    var year = thu.getUTCFullYear();
    var jan4 = new Date(Date.UTC(year, 0, 4));
    var week1 = new Date(jan4.getTime() + (3 - ((jan4.getUTCDay() + 6) % 7)) * DAY);
    return { year: year, week: 1 + Math.round((thu - week1) / (7 * DAY)) };
  }

  function renderCoverage() {
    var grid = $("coverage-grid");
    if (!ROWS.length) return;

    // A session that fell on the wrong weekday still belongs to its own week,
    // so weeks are keyed by the Thursday they contain.
    var weeks = Object.create(null);
    ROWS.forEach(function (r) {
      var thu = thursdayOf(r.date);
      var w = isoWeek(thu);
      var k = w.year + "-" + w.week;
      var cell = weeks[k] || (weeks[k] = { date: r.date, symptoms: 0, note: "" });
      if (isExcluded(r)) {
        if (!cell.note) cell.note = r.raw;
      } else {
        cell.symptoms++;
        cell.date = r.date;
      }
    });

    var dates = ROWS.map(function (r) { return r.date; }).sort();
    var cursor = thursdayOf(dates[0]);
    var end = thursdayOf(dates[dates.length - 1]);

    var years = [];
    var counts = { full: 0, empty: 0, none: 0 };
    while (cursor <= end) {
      var w = isoWeek(cursor);
      var row = years[years.length - 1];
      if (!row || row.year !== w.year) {
        row = { year: w.year, cells: [] };
        years.push(row);
      }
      var hit = weeks[w.year + "-" + w.week];
      var state = !hit ? "none" : hit.symptoms ? "full" : "empty";
      counts[state]++;
      row.cells.push({ week: w.week, state: state, hit: hit, iso: isoDate(cursor) });
      cursor = new Date(cursor.getTime() + 7 * DAY);
    }

    grid.innerHTML = years.map(function (row) {
      var cells = [];
      var first = row.cells[0].week;
      var last = row.cells[row.cells.length - 1].week;
      for (var i = 1; i < first; i++) cells.push('<i class="cov-cell is-void"></i>');
      row.cells.forEach(function (c) {
        var label, cls = "cov-cell is-" + c.state;
        if (c.state === "full") {
          label = c.hit.date + " — " + c.hit.symptoms +
                  (c.hit.symptoms === 1 ? " symptom" : " symptoms");
        } else if (c.state === "empty") {
          label = c.hit.date + " — " + (c.hit.note || "session logged, no symptoms");
        } else {
          label = "week of " + c.iso + " — no record";
        }
        cells.push(c.state === "none"
          ? '<i class="' + cls + '" title="' + label + '"></i>'
          : '<button type="button" class="' + cls + '" title="' + label +
            '" data-cov="' + (c.hit ? c.hit.date : c.iso) + '"><span class="vh">' +
            label + "</span></button>");
      });
      for (var j = last; j < 53; j++) cells.push('<i class="cov-cell is-void"></i>');
      return '<span class="cov-year">' + row.year + "</span>" +
             '<span class="cov-row">' + cells.join("") + "</span>";
    }).join("");

    var total = counts.full + counts.empty + counts.none;
    $("coverage-count").textContent =
      num(counts.full) + " of " + num(total) + " weeks hold symptoms" +
      (counts.empty ? "  ·  " + num(counts.empty) + " logged without any" : "") +
      "  ·  " + num(counts.none) + " with no record";
  }

  function isoDate(d) { return d.toISOString().slice(0, 10); }

  /* ---------- rendering ---------- */

  function renderHeader(s) {
    $("f-records").textContent  = num(s.records);
    $("f-unique").textContent   = num(s.unique);
    $("f-sessions").textContent = num(s.sessions);
    $("f-span").innerHTML = s.first
      ? '<span class="nb">' + s.first + '</span> → <span class="nb">' + s.latest + "</span>"
      : "—";

    var changed = DATA.generated ? new Date(DATA.generated) : null;
    var stamp = changed && !isNaN(changed)
      ? changed.toLocaleString("en-GB", { dateStyle: "long", timeStyle: "short" })
      : null;
    $("f-updated").textContent = s.latest || "—";
    $("f-updated").title = stamp ? "Latest session. Data file last changed " + stamp
                                 : "Latest session";
    $("foot-built").textContent = stamp || "—";
  }

  function renderSpecimen() {
    var pool = activeRows();
    if (!pool.length) return;
    var r = pool[Math.floor(Math.random() * pool.length)];
    $("specimen-name").textContent = r.name;
    $("specimen-note").textContent = r.note;
    $("specimen-id").textContent = r.id;
    $("specimen-date").textContent = "logged " + longDate(r.date);
    var n = ROWS.filter(function (x) { return x.key === r.key && !isExcluded(x); }).length;
    $("specimen-repeat").textContent = n > 1 ? "  ·  used " + n + " times" : "";
  }

  function renderTable() {
    var s = stats();
    var ts = terms();
    var pool = state.showExcluded ? ROWS : activeRows();

    if (state.scope === "latest" && !ts.length) {
      pool = pool.filter(function (r) { return r.date === s.latest; });
    }
    if (ts.length) {
      pool = pool.filter(function (r) { return matches(r, ts); });
    }

    var key = state.sort;
    var rows = pool.slice().sort(function (a, b) {
      var primary = key === "date"
        ? (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)
        : cmp(a.sortName, b.sortName);
      if (primary !== 0) return primary * state.dir;
      return key === "date" ? cmp(a.sortName, b.sortName)
                            : (a.date < b.date ? 1 : a.date > b.date ? -1 : 0);
    });

    var html = rows.map(function (r) {
      var name = highlight(r.name, ts);
      var note = r.note ? '<span class="sym-note">' + highlight(r.note, ts) + "</span>" : "";
      var tag = r.repeats > 1
        ? '<span class="repeat-tag" title="Logged ' + r.repeats + ' times">×' + r.repeats + "</span>"
        : "";
      return '<tr' + (isExcluded(r) ? ' class="is-excluded"' : "") + ">" +
        '<td class="col-date"><button type="button" data-date="' + r.date +
          '" title="Show this session">' + r.date + "</button></td>" +
        '<td class="col-name">' + name + note + tag + "</td></tr>";
    }).join("");

    $("tbody").innerHTML = html;
    $("empty").hidden = rows.length > 0;

    var line;
    if (ts.length) {
      line = num(rows.length) + " of " + num(s.records) + " records match “" + state.q.trim() + "”";
    } else if (state.scope === "latest") {
      line = "Session " + (s.latest || "—") + " — " + num(rows.length) + " entries" +
             "  ·  showing the most recent session of " + num(s.sessions);
    } else if (state.showExcluded) {
      line = "All " + num(rows.length) + " rows, including " + num(s.excluded) + " excluded";
    } else {
      line = "All " + num(rows.length) + " records across " + num(s.sessions) + " sessions";
    }
    $("result-line").textContent = line;

    renderHeader(s);
    $("ex-count").textContent = num(s.excluded);
  }

  function renderSortIndicators() {
    document.querySelectorAll("th.sortable").forEach(function (th) {
      var on = th.dataset.sort === state.sort;
      th.setAttribute("aria-sort", on ? (state.dir === 1 ? "ascending" : "descending") : "none");
    });
  }

  function renderScope() {
    $("scope-latest").setAttribute("aria-pressed", String(state.scope === "latest"));
    $("scope-all").setAttribute("aria-pressed", String(state.scope === "all"));
  }

  function renderNotes() {
    var rows = ROWS.filter(isExcluded).sort(function (a, b) {
      return a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
    });
    $("ex-list").innerHTML = rows.map(function (r) {
      return "<li><button type=\"button\" data-note=\"" + r.date + "\">" +
        "<time>" + r.date + "</time><span>" + esc(r.raw) + "</span></button></li>";
    }).join("");
    $("ex-list").hidden = rows.length === 0;
    $("ex-badge").textContent = rows.length ? "(" + rows.length + ")" : "";
  }

  function renderChips() {
    var all = DATA.config.exclude_contains.map(function (t) { return { t: t, fixed: true }; })
      .concat(state.extra.map(function (t) { return { t: t, fixed: false }; }));
    $("ex-chips").innerHTML = all.map(function (c) {
      return "<li>" + esc(c.t) + (c.fixed ? "" : " (this browser)") + "</li>";
    }).join("");
  }

  /* ---------- URL state ---------- */

  function readHash() {
    var p = new URLSearchParams(location.hash.slice(1));
    if (p.has("q")) state.q = p.get("q");
    if (p.get("sort") === "date" || p.get("sort") === "name") state.sort = p.get("sort");
    if (p.get("dir") === "desc") state.dir = -1;
    if (p.get("scope") === "all") state.scope = "all";
    if (p.has("exclude")) {
      state.extra = p.get("exclude").split("|").map(fold).filter(Boolean);
    }
  }

  function writeHash() {
    var p = new URLSearchParams();
    if (state.q.trim()) p.set("q", state.q.trim());
    if (state.sort !== "name") p.set("sort", state.sort);
    if (state.dir === -1) p.set("dir", "desc");
    if (state.scope !== "latest") p.set("scope", "all");
    if (state.extra.length) p.set("exclude", state.extra.join("|"));
    var h = p.toString();
    history.replaceState(null, "", h ? "#" + h : location.pathname + location.search);
  }

  function update() {
    if (covSig !== signature()) {          // only exclusions can change coverage
      covSig = signature();
      renderCoverage();
    }
    renderSortIndicators();
    renderScope();
    renderChips();
    renderNotes();
    renderTable();
    writeHash();
  }

  /* ---------- wiring ---------- */

  function wire() {
    $("q").addEventListener("input", function (e) {
      var had = state.q.trim().length > 0;
      state.q = e.target.value;
      var has = state.q.trim().length > 0;
      // Searching only makes sense across everything; go back to the latest
      // session when the box is emptied again.
      if (has && !had) state.scope = "all";
      if (!has && had) state.scope = "latest";
      $("q-clear").hidden = !has;
      update();
    });

    $("q-clear").addEventListener("click", function () {
      state.q = "";
      state.scope = "latest";
      state.showExcluded = false;
      $("q").value = "";
      $("q-clear").hidden = true;
      $("q").focus();
      update();
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "/" && document.activeElement !== $("q") && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        $("q").focus();
        $("q").select();
      } else if (e.key === "Escape" && document.activeElement === $("q")) {
        $("q-clear").click();
      }
    });

    document.querySelectorAll("th.sortable button").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var key = btn.parentElement.dataset.sort;
        if (state.sort === key) {
          state.dir = -state.dir;
        } else {
          state.sort = key;
          state.dir = key === "date" ? -1 : 1;   // dates newest-first, names A→Z
        }
        update();
      });
    });

    $("scope-latest").addEventListener("click", function () {
      state.scope = "latest";
      state.showExcluded = false;
      state.q = ""; $("q").value = ""; $("q-clear").hidden = true;
      update();
    });
    $("scope-all").addEventListener("click", function () {
      state.scope = "all";
      update();
    });

    $("tbody").addEventListener("click", function (e) {
      var btn = e.target.closest("button[data-date]");
      if (!btn) return;
      state.q = btn.dataset.date;
      state.scope = "all";
      $("q").value = state.q;
      $("q-clear").hidden = false;
      update();
      document.getElementById("index").scrollIntoView({ block: "start" });
    });

    $("specimen-draw").addEventListener("click", renderSpecimen);

    $("ex-list").addEventListener("click", function (e) {
      var btn = e.target.closest("button[data-note]");
      if (!btn) return;
      state.q = btn.dataset.note;
      state.scope = "all";
      state.showExcluded = true;
      $("q").value = state.q;
      $("q-clear").hidden = false;
      update();
      $("index").scrollIntoView({ block: "start" });
    });

    $("coverage-grid").addEventListener("click", function (e) {
      var cell = e.target.closest("button[data-cov]");
      if (!cell) return;
      state.q = cell.dataset.cov;
      state.scope = "all";
      state.showExcluded = cell.classList.contains("is-empty");
      $("q").value = state.q;
      $("q-clear").hidden = false;
      update();
      $("index").scrollIntoView({ block: "start" });
    });

    var exTimer;
    $("ex").addEventListener("input", function (e) {
      clearTimeout(exTimer);
      exTimer = setTimeout(function () {
        state.extra = e.target.value.split(/[\n,]/).map(function (t) {
          return fold(t.trim());
        }).filter(Boolean);
        update();
      }, 250);
    });

  }

  /* ---------- boot ---------- */

  function prepare(entries, cfg, updated) {
    DATA = { config: cfg, generated: updated };
    var counts = Object.create(null);
    entries.forEach(function (e) {
      if (!e.excluded) counts[e.key] = (counts[e.key] || 0) + 1;
    });
    ROWS = entries.map(function (e) {
      return {
        id: e.id,
        date: e.date,
        name: e.name,
        note: e.note,
        key: e.key,
        excluded: e.excluded,
        raw: e.raw,
        repeats: counts[e.key] || 1,
        sortName: e.name,
        haystack: fold(e.raw + " " + e.name + " " + e.date)
      };
    });

    document.title = cfg.subtitle ? cfg.title + " — " + cfg.subtitle : cfg.title;
    $("site-title").textContent = cfg.title;
    $("site-sub").textContent = cfg.subtitle || "";
    $("site-sep").hidden = !(cfg.subtitle && cfg.blurb);
    $("site-blurb").textContent = cfg.blurb || "";
    $("foot-note").textContent = cfg.footer_note || "";
    if (cfg.repo_url) {
      $("foot-repo").innerHTML =
        ' <span class="sep">·</span> <a href="' + esc(cfg.repo_url) + '">source</a>';
    }
  }

  function grab(path) {
    return fetch(path, { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error(path + " → HTTP " + r.status);
      return r.text().then(function (body) {
        return { body: body, modified: r.headers.get("last-modified") };
      });
    });
  }

  Promise.all([grab("data/symptoms.csv"), grab("data/config.json")])
    .then(function (res) {
      var cfg = JSON.parse(res[1].body);
      var entries = buildEntries(res[0].body, cfg);
      if (!entries.length) throw new Error("no records found in data/symptoms.csv");

      prepare(entries, cfg, res[0].modified);
      readHash();
      $("q").value = state.q;
      $("q-clear").hidden = !state.q.trim();
      if (state.extra.length) {
        $("ex").value = state.extra.join("\n");
        document.querySelector(".filters").open = true;
      }
      wire();
      renderSpecimen();
      update();
    })
    .catch(function (err) {
      $("result-line").textContent = "Could not load the data: " + err.message +
        ". Check that data/symptoms.csv and data/config.json sit next to index.html.";
    });
})();
