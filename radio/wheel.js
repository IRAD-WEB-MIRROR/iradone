/* Radio wheel: what a station's web stream is playing at a given moment.
 *
 * Everyone hears the same thing at the same minute: the item and the offset into it come from the clock, not from
 * page load, so no streaming server is needed. The station's schedule says which programme is on (the page passes a
 * slot(ms) function); the wheel file says what audio goes with it:
 *   tracks   { id: { src, title, by, dur } }      dur in seconds
 *   cues     { showId: [trackId | {track, at}] }  played in turn from the start of the programme (or `at`
 *                                                 seconds into it)
 *   rotation { showId: [trackId, ...] }           after the cues, looped for the rest of the programme in an order
 *                                                 shuffled by the date, so the day's running order is fixed;
 *                                                 "*" is every programme not listed in `talk`
 * slot(ms) returns { id, title, startMs, endMs } or { off: true, endMs } (closed down until endMs).
 */
(function (global) {
  "use strict";

  function hash(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function shuffled(list, seed) {
    var a = list.slice(), x = seed || 1;
    for (var i = a.length - 1; i > 0; i--) { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; var j = (x >>> 0) % (i + 1); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }

  function create(opts) {
    var W = opts.wheel || {}, T = W.tracks || {}, base = opts.base || "";
    function track(id) { var t = T[id]; return t ? { id: id, src: base + t.src, title: t.title, by: t.by || "", dur: t.dur } : null; }
    function now() {
      try { if (global.IradClock && global.IradClock.now) { var v = global.IradClock.now(); return v && v.getTime ? v.getTime() : +v; } } catch (e) {}
      return Date.now();
    }

    // { slot, track, offset (s), untilMs } or { slot, track: null }
    function at(ms) {
      var s = opts.slot(ms);
      if (!s || s.off) return { slot: s, track: null };
      var t = (ms - s.startMs) / 1000, i, tr, pos = 0;
      var cues = (W.cues || {})[s.id] || [];
      for (i = 0; i < cues.length; i++) {          // a cue is a track id, or { track, at } to start `at` s in
        var c = typeof cues[i] === "string" ? { track: cues[i] } : cues[i];
        tr = track(c.track); if (!tr) continue;
        if (c.at !== undefined) pos = c.at;
        if (t >= pos && t < pos + tr.dur) return { slot: s, track: tr, offset: t - pos, untilMs: ms + (pos + tr.dur - t) * 1000 };
        pos += tr.dur;
      }
      t -= pos;
      if (t < 0) return { slot: s, track: null };
      var R = W.rotation || {}, pool = (R[s.id] || ((W.talk || []).indexOf(s.id) < 0 && R["*"]) || []).map(track).filter(Boolean);
      if (!pool.length) return { slot: s, track: null };
      var order = shuffled(pool, hash(new Date(s.startMs).toISOString().slice(0, 10) + s.id));
      var total = order.reduce(function (a, b) { return a + b.dur; }, 0);
      t = t % total;
      for (i = 0; i < order.length; i++) {
        if (t < order[i].dur) {
          var until = Math.min(ms + (order[i].dur - t) * 1000, s.endMs);
          return { slot: s, track: order[i], offset: t, untilMs: until };
        }
        t -= order[i].dur;
      }
      return { slot: s, track: null };
    }

    // The next moment (within `days`) the web stream has something: { ms, slot, track }
    function next(ms, days) {
      var limit = ms + (days || 8) * 86400000, guard = 0, s;
      while (ms < limit && guard++ < 400) {
        s = opts.slot(ms);
        if (!s) return null;
        if (!s.off) {
          var c0 = ((W.cues || {})[s.id] || [])[0], at0 = c0 && typeof c0 === "object" && c0.at ? c0.at * 1000 : 0;
          var first = c0 ? track(typeof c0 === "string" ? c0 : c0.track) : null;
          var R = W.rotation || {}, rot = (R[s.id] || ((W.talk || []).indexOf(s.id) < 0 && R["*"]) || []).map(track).filter(Boolean);
          if ((first || rot.length) && s.startMs + at0 > ms - 1) return { ms: s.startMs + at0, slot: s, track: first || rot[0] };
        }
        ms = Math.max(s.endMs, ms + 60000);
      }
      return null;
    }

    // A player on an <audio> element. ui(state) is called on every change: state.playing (bool), state.item (at()),
    // state.next (next()), state.error.
    function player(audio, ui) {
      var on = false, cur = null, timer = null;
      function draw(extra) {
        var ms = now(), it = at(ms);
        ui({ playing: on && !!cur, armed: on, item: it, next: it.track ? null : next(ms), error: extra && extra.error });
        return it;
      }
      function load() {
        clearTimeout(timer);
        var it = draw();
        if (!on) return;
        if (!it.track) { cur = null; audio.pause(); timer = setTimeout(load, 30000); return; }
        if (!cur || cur.id !== it.track.id || Math.abs(audio.currentTime - it.offset) > 4) {
          cur = it.track;
          audio.src = it.track.src;
          var seek = function () { audio.removeEventListener("loadedmetadata", seek); try { audio.currentTime = at(now()).offset || 0; } catch (e) {} };
          audio.addEventListener("loadedmetadata", seek);
          var p = audio.play(); if (p && p.catch) p.catch(function () { on = false; cur = null; draw({ error: true }); });
          draw();
        }
        timer = setTimeout(load, Math.max(1000, Math.min(30000, it.untilMs - now() + 300)));
      }
      audio.addEventListener("ended", function () { cur = null; load(); });
      audio.addEventListener("error", function () { if (on) { on = false; cur = null; draw({ error: true }); } });
      draw();
      setInterval(function () { if (!on) draw(); }, 30000);
      return {
        toggle: function () { on = !on; if (!on) { audio.pause(); cur = null; clearTimeout(timer); draw(); } else load(); return on; },
        refresh: draw
      };
    }

    return { at: at, next: next, now: now, player: player, track: track };
  }

  global.IradWheel = { create: create };
})(typeof window !== "undefined" ? window : globalThis);
