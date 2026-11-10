/* Radio Irad: the web stream player on iradone.com/radio/. Needs schedule.js (IradSchedule) and wheel.js. */
(function () {
  "use strict";
  var S = window.IradSchedule, MS_H = 3600000, DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var box = document.querySelector("[data-radio-live]");
  if (!box || !S || !window.IradWheel) return;

  function getJson(u) { return fetch(u, { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error(u); return r.json(); }); }
  function hm(ms) { var d = new Date(ms + 6 * MS_H); return ("0" + d.getUTCHours()).slice(-2) + ":" + ("0" + d.getUTCMinutes()).slice(-2); }
  function dayOf(ms) { var d = new Date(ms + 6 * MS_H); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); }
  function when(ms, now) {
    var n = Math.round((dayOf(ms) - dayOf(now)) / 86400000);
    return hm(ms) + (n === 0 ? " today" : n === 1 ? " tomorrow" : " on " + DAYS[new Date(ms + 6 * MS_H).getUTCDay()]);
  }

  Promise.all([getJson(box.getAttribute("data-radio") || "../radio.json"), getJson(box.getAttribute("data-wheel") || "wheel.json")]).then(function (r) {
    var radio = r[0], wheel = r[1], hosts = {};
    (radio.presenters || []).forEach(function (p) { p.shows.forEach(function (s) { (hosts[s] = hosts[s] || []).push(p.name); }); });

    // the programme on air at a moment, as the wheel wants it
    function slot(ms) {
      var bt = S.broadcastToday(ms), day = S.buildDay(radio, bt.date), base = bt.date.getTime() - 6 * MS_H;
      var L = day.slots;
      for (var i = 0; i < L.length; i++) {
        if (bt.minute >= L[i].start && bt.minute < L[i].end)
          return { id: L[i].id, title: L[i].title, startMs: base + L[i].start * 60000, endMs: base + L[i].end * 60000 };
      }
      if (L.length && bt.minute < L[0].start) return { off: true, endMs: base + L[0].start * 60000 };
      var nd = S.addDays(bt.date, 1), first = S.buildDay(radio, nd).slots[0];
      return { off: true, endMs: nd.getTime() - 6 * MS_H + (first ? first.start : 330) * 60000 };
    }

    var W = window.IradWheel.create({ wheel: wheel, slot: slot });
    var btn = box.querySelector(".radio-play"), line = box.querySelector(".radio-now-line"), sub = box.querySelector(".radio-now-sub");
    var audio = box.querySelector("audio");

    function ui(st) {
      var it = st.item, s = it.slot, now = W.now();
      btn.textContent = st.playing ? "■ Stop" : "▶ Listen";
      btn.setAttribute("aria-pressed", st.playing ? "true" : "false");
      box.classList.toggle("is-playing", st.playing);
      if (st.error) { line.textContent = "The web stream could not be opened."; sub.textContent = "Try again in a moment, or tune in on FM."; return; }
      if (it.track) {
        line.innerHTML = "";
        line.appendChild(document.createTextNode(st.playing ? "Now playing: " : "On the web stream now: "));
        var b = document.createElement("strong"); b.textContent = it.track.title; line.appendChild(b);
        sub.textContent = (it.track.by ? it.track.by + " · " : "") + s.title + ", " + hm(s.startMs) + " Irad Time";
        return;
      }
      if (s && s.off) line.textContent = "Radio Irad has closed down for the night.";
      else if (s) {
        line.innerHTML = "On FM now: <strong></strong>" + (hosts[s.id] ? " with " + hosts[s.id].join(" and ") : "");
        line.querySelector("strong").textContent = s.title;
      }
      var nx = st.next;
      sub.textContent = nx ? (st.armed ? "Stay tuned: the web stream" : "The web stream") + " comes on at " + when(nx.ms, now) + " with " + nx.track.title + " (" + nx.slot.title + ")."
                           : "The web stream is off.";
    }
    var p = W.player(audio, ui);
    btn.disabled = false;
    btn.addEventListener("click", function () { p.toggle(); });
  }).catch(function (e) {
    var l = box.querySelector(".radio-now-line"); if (l) l.textContent = "The web stream is unavailable right now.";
    if (window.console) console.error(e);
  });
})();
