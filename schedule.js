/* IradOne programme schedule.
 *
 * Builds the TV guide from schedule.json. Every visitor sees the same
 * schedule for a given date: films, episodes and topics are chosen by a
 * seeded random number generator keyed on the date, not on page load.
 * All times are Irad Time (UTC+6). The broadcast day runs from 05:00 to
 * 05:00, so a programme at 01:30 belongs to the previous day's schedule.
 *
 * The engine (IradSchedule.buildDay) has no DOM dependencies, so it can be
 * tested on its own.
 */
(function (global) {
  "use strict";

  var IRT_OFFSET_HOURS = 6;
  var DAY_START_MIN = 5 * 60;          // broadcast day starts at 05:00
  var DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var MS_DAY = 86400000;

  // ---------- dates (calendar dates are UTC-midnight Date objects) ----------

  function ymd(d) { return d.toISOString().slice(0, 10); }
  function parseYmd(s) { return new Date(s + "T00:00:00Z"); }
  function addDays(d, n) { return new Date(d.getTime() + n * MS_DAY); }
  function daysBetween(a, b) { return Math.round((b.getTime() - a.getTime()) / MS_DAY); }

  function nowIrt(nowMs) {
    // A Date whose UTC fields read as Irad wall-clock time.
    return new Date((nowMs === undefined ? Date.now() : nowMs) + IRT_OFFSET_HOURS * 3600000);
  }

  function broadcastToday(nowMs) {
    var irt = nowIrt(nowMs);
    var mins = irt.getUTCHours() * 60 + irt.getUTCMinutes();
    var day = new Date(Date.UTC(irt.getUTCFullYear(), irt.getUTCMonth(), irt.getUTCDate()));
    return { date: mins < DAY_START_MIN ? addDays(day, -1) : day,
             minute: mins < DAY_START_MIN ? mins + 1440 : mins };
  }

  function easterSunday(year) {  // Gregorian (the church calendar since 1931)
    var a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
    var f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
    var h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
    var l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    var month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(Date.UTC(year, month - 1, day));
  }

  // ---------- times ----------

  function toMin(t) {  // "01:30" -> 1530 (after midnight counts as the same broadcast day)
    var p = t.split(":"), m = parseInt(p[0], 10) * 60 + parseInt(p[1], 10);
    return m < DAY_START_MIN ? m + 1440 : m;
  }

  function fmtMin(m) {
    m = m % 1440;
    var h = Math.floor(m / 60), mm = m % 60;
    return (h < 10 ? "0" : "") + h + ":" + (mm < 10 ? "0" : "") + mm;
  }

  // ---------- seeded randomness ----------

  function hashString(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  function rng(seed) {  // mulberry32
    var a = typeof seed === "string" ? hashString(seed) : seed;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function shuffled(list, seed) {
    var out = list.slice(), r = rng(seed);
    for (var i = out.length - 1; i > 0; i--) {
      var j = Math.floor(r() * (i + 1)), tmp = out[i]; out[i] = out[j]; out[j] = tmp;
    }
    return out;
  }

  function pick(list, seed) { return list[Math.floor(rng(seed)() * list.length)]; }

  // ---------- specials ----------

  function specialMatches(sp, date) {
    var mmdd = ymd(date).slice(5), year = date.getUTCFullYear();
    if (sp.date) return sp.date.length === 5 ? sp.date === mmdd : sp.date === ymd(date);
    if (typeof sp.easter === "number") return ymd(addDays(easterSunday(year), sp.easter)) === ymd(date);
    if (sp.nth_weekday) {
      var nw = sp.nth_weekday;
      if (date.getUTCMonth() + 1 !== nw.month || DAY_KEYS[date.getUTCDay()] !== nw.weekday) return false;
      return Math.floor((date.getUTCDate() - 1) / 7) + 1 === nw.n;
    }
    if (sp.first_weekday_after) {
      var fw = sp.first_weekday_after, p = fw.date.split("-");
      var d = new Date(Date.UTC(year, parseInt(p[0], 10) - 1, parseInt(p[1], 10)));
      do { d = addDays(d, 1); } while (DAY_KEYS[d.getUTCDay()] !== fw.weekday);
      return ymd(d) === ymd(date);
    }
    return false;
  }

  // ---------- programme details ----------

  function airingsSince(start, every, date) {
    // How many times a show airing on `every` weekdays has aired from `start` up to and including `date`.
    var days = daysBetween(start, date);
    if (days < 0) return 0;
    var weeks = Math.floor(days / 7), n = weeks * every.length;
    for (var i = weeks * 7; i <= days; i++) {
      if (every.indexOf(DAY_KEYS[addDays(start, i).getUTCDay()]) !== -1) n++;
    }
    return n;
  }

  function headlineFor(news, date, maxAgeDays, today) {
    if (!news || !news.length || date.getTime() > today.getTime()) return null;
    for (var i = 0; i < news.length; i++) {
      var pub = parseYmd(news[i].published.slice(0, 10));
      var age = daysBetween(pub, date);
      if (age >= 0 && age <= maxAgeDays) return news[i];
    }
    return null;
  }

  function detailFor(id, show, date, data, news, today, slotIndex) {
    var d = show.detail;
    if (!d) return null;
    var key = ymd(date) + "|" + id + "|" + slotIndex;
    var pool = d.pool ? data.pools[d.pool] : null;
    switch (d.type) {
      case "pool":
        return (d.prefix || "") + pick(pool, key);
      case "film": {
        // One shuffle per week and pool, so a film doesn't repeat within the week.
        var films = data.films[d.pool];
        var week = Math.floor(daysBetween(parseYmd("2024-01-01"), date) / 7);
        var order = shuffled(films, d.pool + "|week" + week);
        return order[((date.getUTCDay() + 6) % 7) % order.length];  // Monday-first, 7 different films a week
      }
      case "series": {
        var n = airingsSince(parseYmd(d.start), d.every, date);
        if (n < 1) return null;
        if (!pool) return (d.label || "Episode") + " " + n;
        var len = pool.length;
        if (d.parts_per_item) {  // a serial reading: several parts per book
          var ppi = d.parts_per_item;
          return pool[Math.floor((n - 1) / ppi) % len] + ", part " + ((n - 1) % ppi + 1) + " of " + ppi;
        }
        var idx = (n - 1) % len;
        return (d.label || "Ep.") + " " + (idx + 1) + ": " + pool[idx];
      }
      case "serial": {
        var ep = airingsSince(parseYmd(d.start), d.every, date) + (d.first_episode || 1) - 1;
        if (ep < 1) return null;
        return "Episode " + ep + ": " + pool[(ep - 1) % pool.length];
      }
      case "headline": {
        var h = headlineFor(news, date, 1, today);
        return h ? (d.prefix || "") + h.headline : null;
      }
      case "sport": {
        var sp = global.IradSport;
        return sp && sp.tvDetail ? sp.tvDetail(d.kind, date) : null;
      }
      case "headline_or_pool": {
        var hh = headlineFor(news, date, d.max_age_days || 3, today);
        return (d.prefix || "") + (hh ? hh.headline : pick(pool, key));
      }
    }
    return null;
  }

  // ---------- building a day ----------

  function resolveShow(ref, date) {
    if (!ref) return null;
    if (typeof ref === "string") return ref;
    if (ref.months && ref.months.indexOf(date.getUTCMonth() + 1) === -1) return resolveShow(ref.else, date);
    return ref.show;
  }

  function buildDay(data, date, news, today) {
    var key = DAY_KEYS[date.getUTCDay()];
    var grid = key === "sat" ? data.grids.saturday : key === "sun" ? data.grids.sunday : data.grids.weekday;
    var slots = [];
    grid.forEach(function (g) {
      var ref = g.by_day ? g.by_day[key] : g.show;
      var id = resolveShow(ref, date);
      if (id) slots.push({ start: toMin(g.t), id: id });
    });

    var specials = (data.specials || []).filter(function (sp) { return specialMatches(sp, date); });
    specials.forEach(function (sp) {
      sp.slots.forEach(function (s) {
        var from = toMin(s.t), until = toMin(s.until);
        // the programme running when the special ends picks up again afterwards
        var resume = null;
        slots.forEach(function (x) { if (x.start < until) resume = x; });
        slots = slots.filter(function (x) { return x.start < from || x.start >= until; });
        slots.push({ start: from, id: s.show, special: sp.name });
        var hasAtUntil = slots.some(function (x) { return x.start === until; });
        if (resume && !resume.special && resume.start < from && !hasAtUntil && resume.id !== "signoff") {
          slots.push({ start: until, id: resume.id, resumed: true });
        }
      });
    });

    slots.sort(function (a, b) { return a.start - b.start; });
    slots = slots.filter(function (s, i) { return i === 0 || s.id !== slots[i - 1].id || s.special; });

    return {
      date: ymd(date),
      dayName: DAY_NAMES[date.getUTCDay()],
      specials: specials.map(function (s) { return s.name; }),
      slots: slots.map(function (s, i) {
        var show = data.shows[s.id] || { title: s.id, desc: "" };
        var next = slots[i + 1];
        return {
          time: fmtMin(s.start), start: s.start,
          end: next ? next.start : s.start + 5,
          id: s.id, title: show.title, subtitle: show.subtitle || null, desc: show.desc,
          detail: s.resumed ? "Continued" : detailFor(s.id, show, date, data, news, today, i),
          special: !!s.special
        };
      })
    };
  }

  // ---------- on air / off air ----------

  // What the channel is doing at a moment: { on: slot } while a programme runs, or { off: true, resume: slot }
  // between Sign Off and the next Sign On (overnight, Irad Time).
  function airState(data, nowMs) {
    var bt = broadcastToday(nowMs), day = buildDay(data, bt.date), slots = day.slots;
    for (var i = 0; i < slots.length; i++) {
      if (bt.minute >= slots[i].start && bt.minute < slots[i].end) return { on: slots[i], date: day.date };
    }
    if (slots.length && bt.minute < slots[0].start) return { off: true, resume: slots[0] };
    var next = buildDay(data, addDays(bt.date, 1)).slots[0];
    return { off: true, resume: next };
  }

  // The test card shown in the Live TV player overnight. It is only a picture: a click still plays the video,
  // and nothing else on the page changes.
  function testCard(irtMin, resume) {
    var bars = ["#c0c0c0", "#c0c000", "#00c0c0", "#00c000", "#c000c0", "#c00000", "#0000c0"], w = 1280 / 7, r = [];
    bars.forEach(function (c, i) { r.push('<rect x="' + (i * w).toFixed(1) + '" y="0" width="' + (w + 1).toFixed(1) + '" height="520" fill="' + c + '"/>'); });
    ["#0000c0", "#131313", "#c000c0", "#131313", "#00c0c0", "#131313", "#c0c0c0"].forEach(function (c, i) {
      r.push('<rect x="' + (i * w).toFixed(1) + '" y="520" width="' + (w + 1).toFixed(1) + '" height="60" fill="' + c + '"/>');
    });
    ["#00214c", "#ffffff", "#32006a", "#131313", "#090909", "#131313", "#1d1d1d", "#131313"].forEach(function (c, i) {
      r.push('<rect x="' + (i * 160) + '" y="580" width="161" height="140" fill="' + c + '"/>');
    });
    var t = fmtMin(irtMin);
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720">' + r.join("") +
      '<circle cx="640" cy="300" r="190" fill="#111" stroke="#fff" stroke-width="6"/>' +
      '<line x1="450" y1="300" x2="830" y2="300" stroke="#fff" stroke-width="2" opacity=".5"/>' +
      '<line x1="640" y1="110" x2="640" y2="490" stroke="#fff" stroke-width="2" opacity=".5"/>' +
      '<rect x="470" y="232" width="340" height="72" fill="#111"/>' +
      '<text x="640" y="290" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="64" font-weight="bold" fill="#fff">IradOne</text>' +
      '<rect x="520" y="318" width="240" height="56" fill="#111"/>' +
      '<text x="640" y="362" text-anchor="middle" font-family="Courier New,monospace" font-size="46" fill="#ffd200">' + t + ' IRT</text>' +
      '<rect x="300" y="646" width="680" height="52" fill="#000"/>' +
      '<text x="640" y="682" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="28" fill="#fff">Programmes resume at ' + (resume ? resume.time : "05:55") + ' Irad Time</text></svg>';
    return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  }

  function liveCard(data) {
    var thumb = document.getElementById("video-thumbnail");
    if (!thumb) return;
    var orig = thumb.getAttribute("src"), origAlt = thumb.getAttribute("alt"), note = document.getElementById("live-note");
    if (!note) {
      note = el("p", "live-note"); note.id = "live-note";
      var box = thumb.closest(".video-container");
      box.parentNode.insertBefore(note, box.nextSibling);
    }
    function tick() {
      var st = airState(data), irt = nowIrt(), m = irt.getUTCHours() * 60 + irt.getUTCMinutes();
      note.innerHTML = "";
      if (st.off) {
        thumb.src = testCard(m, st.resume);
        thumb.alt = "IradOne test card: the channel is off the air";
        note.className = "live-note off-air";
        note.appendChild(el("strong", null, "Off the air. "));
        note.appendChild(document.createTextNode("IradOne closes down overnight. It is " + fmtMin(m) + " in Talas; programmes resume at " +
          (st.resume ? st.resume.time + " with " + st.resume.title : "05:55") + ". Earlier programmes are below, and the news is always on the site."));
      } else {
        if (thumb.getAttribute("src") !== orig) { thumb.src = orig; thumb.alt = origAlt; }
        note.className = "live-note";
        note.appendChild(el("span", "on-now-badge", "On now"));
        note.appendChild(el("strong", null, " " + st.on.title));
        note.appendChild(document.createTextNode(" · " + st.on.time + "–" + fmtMin(st.on.end) + " Irad Time"));
      }
    }
    tick();
    setInterval(tick, 60000);
  }

  // ---------- page ----------

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function render(root, data, news, links) {
    var tabs = root.querySelector(".schedule-tabs");
    var body = root.querySelector(".schedule-day tbody");
    var banner = root.querySelector(".schedule-special");
    var bt = broadcastToday();
    var days = [];
    var count = parseInt(root.getAttribute("data-days") || "7", 10);
    for (var i = 0; i < count; i++) days.push(addDays(bt.date, i));

    function show(index) {
      var date = days[index];
      var day = buildDay(data, date, news, bt.date);
      Array.prototype.forEach.call(tabs.children, function (b, j) {
        b.classList.toggle("active", j === index);
        b.setAttribute("aria-selected", j === index ? "true" : "false");
      });
      if (day.specials.length) {
        banner.textContent = day.specials.join(" · ") + ": special programming";
        banner.hidden = false;
      } else {
        banner.hidden = true;
      }
      body.innerHTML = "";
      day.slots.forEach(function (s) {
        var tr = el("tr");
        var onNow = index === 0 && bt.minute >= s.start && bt.minute < s.end;
        if (onNow) tr.className = "on-now";
        if (s.special) tr.classList.add("special");
        var tdTime = el("td", "slot-time", s.time);
        if (onNow) tdTime.appendChild(el("span", "on-now-badge", "On now"));
        var tdProg = el("td", "slot-title");
        var name = el("strong", null, s.title);
        if (links && s.id !== "signon" && s.id !== "signoff") {
          var a = el("a", "slot-link");
          a.href = links + s.id + ".html";
          a.appendChild(name);
          tdProg.appendChild(a);
        } else {
          tdProg.appendChild(name);
        }
        if (s.subtitle) tdProg.appendChild(el("span", "slot-subtitle", s.subtitle));
        var tdDesc = el("td", "slot-desc");
        if (s.detail) tdDesc.appendChild(el("span", "slot-detail", s.detail));
        tdDesc.appendChild(el("span", null, s.desc));
        tr.appendChild(tdTime); tr.appendChild(tdProg); tr.appendChild(tdDesc);
        body.appendChild(tr);
      });
    }

    tabs.innerHTML = "";
    days.forEach(function (d, i) {
      var label = (i === 0 ? "Today" : i === 1 ? "Tomorrow" : DAY_NAMES[d.getUTCDay()].slice(0, 3)) +
        " · " + MONTHS[d.getUTCMonth()] + " " + d.getUTCDate();
      var b = el("button", "tablink", label);
      b.type = "button";
      b.setAttribute("role", "tab");
      b.addEventListener("click", function () { show(i); });
      tabs.appendChild(b);
    });
    show(0);
  }

  // Upcoming airings of one programme, for its programme page.
  function renderAirings(root, data, news, showId) {
    var bt = broadcastToday();
    var list = root.querySelector(".airings-list");
    var found = [];
    var horizon = parseInt(root.getAttribute("data-horizon") || "14", 10);
    for (var i = 0; i < 400 && (i < horizon || !found.length); i++) {
      var date = addDays(bt.date, i);
      var day = buildDay(data, date, news, bt.date);
      day.slots.forEach(function (s) {
        if (s.id !== showId || s.detail === "Continued") return;
        if (i === 0 && s.end <= bt.minute) return;  // already over today
        found.push({ i: i, date: date, slot: s });
      });
    }
    list.innerHTML = "";
    if (!found.length) {
      list.appendChild(el("li", null, "No airings in the coming year."));
      return;
    }
    found.slice(0, 12).forEach(function (f) {
      var li = el("li");
      var when = f.i === 0 ? "Today" : f.i === 1 ? "Tomorrow" :
        DAY_NAMES[f.date.getUTCDay()] + " " + f.date.getUTCDate() + " " + MONTHS[f.date.getUTCMonth()];
      li.appendChild(el("span", "airing-when", when + ", " + f.slot.time));
      if (f.slot.detail) li.appendChild(el("span", "airing-detail", f.slot.detail));
      if (f.i === 0 && bt.minute >= f.slot.start && bt.minute < f.slot.end) li.appendChild(el("span", "on-now-badge", "On now"));
      list.appendChild(li);
    });
  }

  function getJson(url) {
    return fetch(url, { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error(url); return r.json(); });
  }

  function sportReady() {
    // The TV guide can show tonight's fixtures when the sport engine is on the page.
    return global.IradSport && global.IradSport.ready ? global.IradSport.ready.catch(function () {}) : Promise.resolve();
  }

  function mount(root) {
    var src = root.getAttribute("data-src") || "schedule.json";
    var newsUrl = root.getAttribute("data-news");
    Promise.all([getJson(src), newsUrl ? getJson(newsUrl).catch(function () { return []; }) : [], sportReady()])
      .then(function (res) {
        if (root.hasAttribute("data-airings")) renderAirings(root, res[0], res[1], root.getAttribute("data-airings"));
        else { render(root, res[0], res[1], root.getAttribute("data-links")); liveCard(res[0]); }
      })
      .catch(function (err) {
        var body = root.querySelector(".schedule-day tbody, .airings-list");
        if (body) body.innerHTML = "<li>The schedule is unavailable right now.</li>";
        if (global.console) console.error(err);
      });
  }

  function init() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-schedule], [data-airings]"), mount);
  }

  global.IradSchedule = { buildDay: buildDay, broadcastToday: broadcastToday, airState: airState, easterSunday: easterSunday,
                          parseYmd: parseYmd, addDays: addDays, ymd: ymd, airingsSince: airingsSince };
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
  }
})(typeof window !== "undefined" ? window : globalThis);
