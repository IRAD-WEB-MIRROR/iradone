/* Public notices and mountain pass reports (homepage).
 * Pass status comes from the season section of data/today.json (the same
 * road report as Gidromet and the Gendarmerie); frost on an open pass means
 * ice. Notices come from notices.json by date.
 */
(function () {
  "use strict";

  var IRT_MS = 6 * 3600000;

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function todayIrt() {
    var t = new Date(Date.now() + IRT_MS);
    return { y: t.getUTCFullYear(), md: ("0" + (t.getUTCMonth() + 1)).slice(-2) + "-" + ("0" + t.getUTCDate()).slice(-2) };
  }

  function inRange(from, to, today) {
    var full = today.y + "-" + today.md;
    if (from.length > 5 || to.length > 5) {
      var f = from.length > 5 ? from : today.y + "-" + from, t = to.length > 5 ? to : today.y + "-" + to;
      return full >= f && full <= t;
    }
    return from <= to ? today.md >= from && today.md <= to : today.md >= from || today.md <= to;
  }

  function deg(x) { return String(Math.round(x)).replace("-", "\u2212") + "°C"; }
  // the season section of today's numbers: one road report for every site (Gidromet, the Gendarmerie, Visit Irad)
  function passStatus(pass, season, today) {
    var r = season && season.roads ? season.roads.filter(function (x) { return x.id === pass.id; })[0] : null;
    if (!r) {
      if (pass.season_closed && inRange(pass.season_closed[0], pass.season_closed[1], today)) return { level: "closed", label: "Closed for the season", note: "Reopens in spring." };
      return null;
    }
    var lowTxt = "low " + deg(r.low);
    if (r.status === "winter") return { level: "closed", label: "Closed for the season", note: "Reopens in spring." };
    if (r.status === "closed") return { level: "closed", label: "Closed", note: "Snow on the pass, " + lowTxt + ". Use another route." };
    if (r.status === "chains") return { level: "chains", label: "Chains required", note: (r.snow ? "Snow, " : "") + lowTxt + "." };
    if (r.low <= -8 || (r.low <= -1 && r.snow)) return { level: "ice", label: "Ice: drive with care", note: lowTxt + "." };
    return { level: "open", label: "Open", note: lowTxt + "." };
  }

  function render(root, config, season) {
    var today = todayIrt();
    var roads = root.querySelector(".pass-list");
    var list = root.querySelector(".notice-list");
    roads.innerHTML = "";
    var alerts = [];
    config.passes.forEach(function (p, i) {
      var st = passStatus(p, season, today);
      var li = el("li", "pass" + (st ? " pass-" + st.level : ""));
      var head = el("div", "pass-head");
      head.appendChild(el("strong", null, p.name));
      head.appendChild(el("span", "pass-badge", st ? st.label : "No report"));
      li.appendChild(head);
      li.appendChild(el("span", "pass-road", p.road + " · " + p.elevation.toLocaleString("en-GB") + " m"));
      if (st) li.appendChild(el("span", "pass-note", st.note));
      roads.appendChild(li);
      if (st && st.level === "closed" && st.label === "Closed") alerts.push(p.name + " is closed: " + st.note);
    });

    list.innerHTML = "";
    var items = alerts.map(function (a) { return { text: a, source: "Road Patrol", alert: true }; })
      .concat(config.notices.filter(function (n) { return inRange(n.from, n.to, today); }));
    items.slice(0, 4).forEach(function (n) {
      var li = el("li", n.alert ? "notice-alert" : "");
      li.appendChild(el("span", "notice-source", n.source));
      li.appendChild(el("span", "notice-text", n.text));
      list.appendChild(li);
    });
  }

  function init() {
    var root = document.getElementById("notices");
    if (!root) return;
    fetch("notices.json", { cache: "no-cache" }).then(function (r) { return r.json(); }).then(function (config) {
      render(root, config, null);  // notices straight away; passes when the forecast arrives
      fetch("data/today.json", { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
        .then(function (d) { if (d.season) render(root, config, d.season); })
        .catch(function () { /* passes show "No report" unless season-closed */ });
    }).catch(function () { root.hidden = true; });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
