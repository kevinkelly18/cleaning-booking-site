/*
 * Shared booking math for the customer site and the staff app.
 *
 * A job reserves its cleaner from its start until its end plus travel time,
 * in 15-minute "holds". Each hold is a database document whose id is
 * cleanerId_date_minute, so two bookings can never claim the same block:
 * the second write fails because the document already exists.
 */
(function (root) {
  const HOLD = 15;
  const DEFAULT_DAYS = [1, 2, 3, 4, 5, 6];
  const DEFAULT_SERVICES = [
    { name: "Standard clean", hours: 2, from: 120 },
    { name: "Deep clean", hours: 4, from: 240 },
    { name: "Move-in / move-out", hours: 5, from: 300 },
    { name: "Office / commercial", hours: 2.5, from: 150 },
    { name: "Windows", hours: 2, from: 110 },
  ];

  const pad = n => String(n).padStart(2, "0");
  const mins = hm => { const [h, m] = String(hm || "0:0").split(":").map(Number); return h * 60 + (m || 0); };
  const hm = t => pad(Math.floor(t / 60)) + ":" + pad(t % 60);
  const ymd = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const parseYmd = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };

  function settings(raw) {
    const s = raw || {};
    const services = Array.isArray(s.services) && s.services.length ? s.services : DEFAULT_SERVICES;
    return {
      name: s.name || "Kristally Klean", phone: s.phone || "", email: s.email || "", area: s.area || "", intro: s.intro || "",
      open: s.open || "08:00", close: s.close || "18:00",
      buffer: Number.isFinite(Number(s.buffer)) ? Number(s.buffer) : 30,
      step: Number(s.step) || 30,
      minNoticeHours: Number.isFinite(Number(s.minNoticeHours)) ? Number(s.minNoticeHours) : 24,
      maxDaysAhead: Number(s.maxDaysAhead) || 60,
      cleanerShare: Number.isFinite(Number(s.cleanerShare)) && s.cleanerShare !== "" && s.cleanerShare != null ? Number(s.cleanerShare) : 80,
      services,
      faq: Array.isArray(s.faq) ? s.faq.filter(x => x && x.q) : [],
    };
  }

  /* Minutes a job blocks on its cleaner's calendar (job + travel), rounded up to whole holds. */
  function blockMins(durationHours, buffer) {
    return Math.ceil((Math.round(Number(durationHours) * 60) + Number(buffer || 0)) / HOLD) * HOLD;
  }
  function holdId(cleanerId, date, t) { return cleanerId + "_" + date + "_" + t; }
  function holdIds(cleanerId, date, startMin, blocks) {
    const out = [];
    for (let t = startMin; t < startMin + blocks; t += HOLD) out.push(holdId(cleanerId, date, t));
    return out;
  }

  function worksAt(cleaner, date, startMin, durMin, cfg) {
    if (!cleaner || cleaner.active === false) return false;
    if (!(cleaner.days || DEFAULT_DAYS).includes(parseYmd(date).getDay())) return false;
    const from = cleaner.fromMin ?? mins(cleaner.from || cfg.open);
    const to = cleaner.toMin ?? mins(cleaner.to || cfg.close);
    return startMin >= from && startMin + durMin <= to;
  }

  /*
   * Open start times on one day.
   * taken: Set of hold ids already reserved.
   * now: Date, used to apply the minimum-notice rule (pass null for staff, who can book same-day).
   * Returns [{t, free: [cleaner, ...]}] for every start time inside business hours.
   */
  function slotsFor(date, durationHours, cleaners, taken, cfg, now) {
    const durMin = Math.round(Number(durationHours) * 60);
    const blocks = blockMins(durationHours, cfg.buffer);
    const out = [];
    let earliest = -Infinity;
    if (now) {
      const cutoff = new Date(now.getTime() + cfg.minNoticeHours * 3600000);
      const day = parseYmd(date);
      if (ymd(cutoff) > date) return out;
      if (ymd(cutoff) === date) earliest = cutoff.getHours() * 60 + cutoff.getMinutes();
      if (ymd(day) > ymd(new Date(now.getTime() + cfg.maxDaysAhead * 86400000))) return out;
    }
    for (let t = mins(cfg.open); t + durMin <= mins(cfg.close); t += cfg.step) {
      if (t < earliest) continue;
      const free = cleaners.filter(c => worksAt(c, date, t, durMin, cfg) && holdIds(c.id, date, t, blocks).every(id => !taken.has(id)));
      out.push({ t, free });
    }
    return out;
  }

  const api = { HOLD, DEFAULT_DAYS, DEFAULT_SERVICES, pad, mins, hm, ymd, parseYmd, settings, blockMins, holdId, holdIds, worksAt, slotsFor };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Avail = api;
})(this);
