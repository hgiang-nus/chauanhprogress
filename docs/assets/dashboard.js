/* Châu Anh Progress — static dashboard. Loads data/*.json (written by build.py) and renders every section. */
(() => {
  const FILES = ['sessions', 'weekly', 'syllabus', 'timeline', 'materials', 'observations', 'plan', 'evaluation', 'meta'];
  const SUBJECTS = ['maths', 'econ', 'business'];
  const SPECIAL = new Set(['review', 'skills', 'diagnostic', 'assessment', 'other']);
  const unitLabel = (s) => (SPECIAL.has(s.unit) ? '' : (window.caLang === 'vi' ? s.unit_vi : s.unit_en));
  // Exams in display order. `dashed` marks the SAT line, which is derived from the same Maths sessions.
  const EXAMS = [
    { id: 'maths_p1', subject: 'maths', tile: 't_p1', title: 'h_p1', note: 'n_p1', field: 'coverage', pace: true },
    { id: 'econ_igcse', subject: 'econ', tile: 't_igcse', title: 'h_igcse', note: 'n_igcse', field: 'coverage', pace: true },
    { id: 'business_igcse', subject: 'business', tile: 't_bus', title: 'h_bus', note: 'n_bus', field: 'prepared', pace: false },
    { id: 'sat_math', subject: 'maths', tile: 't_sat', title: 'h_sat', note: 'n_sat', field: 'coverage', pace: false, dashed: true },
  ];
  const D = {};
  let logFilter = 'all';
  const T = () => window.caT[window.caLang];
  const t = (k) => T()[k] ?? k;
  const fmt = (k, o) => t(k).replace(/\{(\w+)\}/g, (_, n) => o[n]);
  const pct = d3.format('.0%');
  const num = (v) => (Number.isInteger(v) ? String(v) : d3.format('.1f')(v));
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const color = () => ({ maths: css('--maths'), econ: css('--econ'), business: css('--business') });
  const name = (r) => (window.caLang === 'vi' ? r.name_vi : r.name_en);

  const fmtDate = (iso, long) => {
    if (!iso) return '—';
    const d = new Date(iso + 'T00:00:00Z');
    if (window.caLang === 'vi') return long ? `${d.getUTCDate()}/${d.getUTCMonth() + 1}/${d.getUTCFullYear()}` : `${d.getUTCDate()}/${d.getUTCMonth() + 1}`;
    return long ? d3.utcFormat('%-d %b %Y')(d) : d3.utcFormat('%-d %b')(d);
  };
  const fmtMonth = (ym) => {
    const [y, m] = ym.split('-');
    return window.caLang === 'vi' ? `Tháng ${Number(m)}/${y}` : d3.utcFormat('%b %Y')(new Date(`${ym}-01T00:00:00Z`));
  };
  const subjName = (s) => (SUBJECTS.includes(s) ? t(s) : t('both'));
  const pill = (cls, text) => { const el = document.createElement('span'); el.className = 'ca-pill ' + cls; el.textContent = text; return el; };
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const frag = (...nodes) => { const f = document.createDocumentFragment(); f.append(...nodes); return f; };

  // ---- derived figures --------------------------------------------------
  function totals() {
    const out = {};
    for (const sub of SUBJECTS) {
      const rows = D.sessions.filter((s) => s.subject === sub);
      const dates = rows.map((s) => s.date).sort();
      out[sub + '_sessions'] = rows.length;
      out[sub + '_hours'] = Math.round(rows.reduce((a, s) => a + Number(s.hours || 0), 0) * 10) / 10;
      out[sub + '_first'] = dates[0] || null;
      out[sub + '_last'] = dates[dates.length - 1] || null;
    }
    const all = D.sessions.map((s) => s.date).sort();
    out.last = all[all.length - 1] || null;
    out.all_sessions = D.sessions.length;
    out.all_hours = Math.round(D.sessions.reduce((a, s) => a + Number(s.hours || 0), 0) * 10) / 10;
    out.weeks = new Set(D.sessions.map((s) => s.week)).size;
    // the Maths log counts as stale when its last entry is more than 3 weeks before the latest entry of any log
    out.maths_stale = out.maths_last && out.last && (new Date(out.last) - new Date(out.maths_last)) / 864e5 > 21;
    return out;
  }
  const share = (exam, field) => {
    const rows = D.syllabus.filter((r) => r.exam === exam);
    const w = rows.reduce((a, r) => a + Number(r.weight), 0);
    return w ? rows.reduce((a, r) => a + Number(r.weight) * Number(r[field] || 0), 0) / w : 0;
  };
  function coverage() {
    const out = {};
    for (const e of EXAMS) out[e.id] = share(e.id, e.field);
    out.business_prepared = share('business_igcse', 'prepared');
    out.business_taught = share('business_igcse', 'coverage');
    return out;
  }
  // Topics still to teach for one exam: [{row, left}] with `left` in percentage points of the exam
  function remaining(exam) {
    const rows = D.syllabus.filter((r) => r.exam === exam);
    const w = rows.reduce((a, r) => a + Number(r.weight), 0);
    return rows.map((r) => ({ row: r, left: Number(r.weight) / w * (1 - Number(r.coverage || 0)) * 100 })).filter((x) => x.left > 0.5);
  }
  function pace(exam) {
    const rows = D.timeline.filter((r) => r.exam === exam);
    if (!rows.length) return null;
    const last = Number(rows[rows.length - 1].coverage), active = rows.filter((r) => Number(r.sessions) > 0).length;
    if (!active || last <= 0) return null;
    const perWeek = last / active;
    return { perWeek, weeksLeft: Math.ceil((1 - last) / perWeek) };
  }
  function examDates(exam) {
    const ex = (D.meta.exams || {})[exam];
    return ex && Array.isArray(ex.dates) ? ex.dates : [];
  }
  function examDateText(exam) {
    const dates = examDates(exam);
    if (!dates.length) return t('exam_tbc');
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const parts = dates.map((d) => `${d.paper} · ${fmtDate(d.date, true)}`);
    const future = dates.map((d) => (new Date(d.date + 'T00:00:00') - today) / 864e5).filter((n) => n >= 0);
    const soon = future.length ? Math.round(Math.min(...future)) : null;
    const tail = soon === null ? t('exam_done') : soon === 0 ? t('exam_today') : fmt('days_left', { n: soon });
    return `${t('exam_on')}: ${parts.join(' · ')} (${tail})`;
  }

  // ---- header & tiles -----------------------------------------------------
  function applyLabels() {
    document.documentElement.lang = window.caLang;
    document.querySelectorAll('[data-t]').forEach((e) => { const v = T()[e.dataset.t]; if (typeof v === 'string') e.textContent = v; });
    document.getElementById('ca-h1').textContent = t('h1');
    document.getElementById('ca-sub').textContent = t('sub');
    document.getElementById('ca-lang-vi').setAttribute('aria-pressed', String(window.caLang === 'vi'));
    document.getElementById('ca-lang-en').setAttribute('aria-pressed', String(window.caLang === 'en'));
  }

  function fillTiles() {
    const tot = totals(), cov = coverage();
    const set = (key, text) => document.querySelectorAll(`[data-f="${key}"]`).forEach((e) => { e.textContent = text; e.classList.remove('ca-skel'); });
    for (const sub of SUBJECTS) {
      set(`totals.${sub}_hours`, num(tot[sub + '_hours']));
      set(`totals.${sub}_sessions`, String(tot[sub + '_sessions']));
      set(`totals.${sub}_first`, fmtDate(tot[sub + '_first']));
      set(`totals.${sub}_last`, fmtDate(tot[sub + '_last']));
    }
    set('totals.all_hours', num(tot.all_hours)); set('totals.all_sessions', String(tot.all_sessions)); set('totals.weeks', String(tot.weeks));
    document.getElementById('ca-business-tile-note').textContent = tot.business_sessions ? `${t('from')} ${fmtDate(tot.business_first)} ${t('to')} ${fmtDate(tot.business_last)}` : t('d_business');

    const box = document.getElementById('ca-exam-tiles');
    box.replaceChildren();
    for (const e of EXAMS) {
      const v = cov[e.id];
      const tile = el('div', 'ca-tile ca-' + e.subject);
      tile.append(el('span', 'ca-k', t(e.tile)));
      const val = el('span', 'ca-v', pct(v));
      tile.append(val);
      const meter = el('div', 'ca-meter'); const fill = el('div', 'ca-mfill' + (e.field === 'prepared' ? ' prepared' : '')); fill.style.width = (v * 100) + '%'; meter.append(fill); tile.append(meter);
      const d1 = e.field === 'prepared' ? t('d_bus_prepared') : `${pct(1 - v)} ${t('remaining')} · ${D.sessions.filter((s) => s.subject === e.subject).length} ${t('sessions')}`;
      tile.append(el('span', 'ca-d', d1), el('span', 'ca-d ca-exam-date', examDateText(e.id)));
      box.append(tile);
    }

    document.getElementById('ca-take').textContent = T().take(
      { ...tot, last_long: fmtDate(tot.last, true), maths_last_long: fmtDate(tot.maths_last, true) },
      { maths_p1: pct(cov.maths_p1), econ_igcse: pct(cov.econ_igcse), sat_math: pct(cov.sat_math), business_prepared: pct(cov.business_prepared) });
    const gen = D.meta && D.meta.generated ? new Date(D.meta.generated) : null;
    document.getElementById('ca-updated').textContent = gen ? gen.toLocaleString(window.caLang === 'vi' ? 'vi-VN' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
  }

  // ---- part 1: coverage timeline ----------------------------------------------
  function timelineSeries() {
    const col = color();
    return EXAMS.filter((e) => D.timeline.some((r) => r.exam === e.id && Number(r.coverage) > 0)).map((e) => ({
      ...e, label: t(e.tile), color: col[e.subject],
      rows: D.timeline.filter((r) => r.exam === e.id).map((r) => ({ week: r.week, date: new Date(r.week + 'T00:00:00Z'), v: Number(r.coverage), sessions: Number(r.sessions) })),
    }));
  }

  function drawTimeline() {
    const box = document.getElementById('ca-timeline'), legend = document.getElementById('ca-tl-legend');
    box.replaceChildren(); legend.replaceChildren(); box.classList.remove('ca-skel');
    const series = timelineSeries();
    if (!series.length) return;
    for (const s of series) {
      const item = el('span'); const sw = el('i', 'ca-sw ca-sw-line' + (s.dashed ? ' dashed' : '')); sw.style.setProperty('--c', s.color);
      item.append(sw, s.label); legend.append(item);
    }
    const weeks = series[0].rows.map((r) => r.date);
    const width = Math.max(box.clientWidth || 600, 320), height = 280;
    const short = width < 720; // narrow screens: label the line ends with the value only, the legend carries the names
    const m = { top: 16, right: short ? 52 : Math.min(160, Math.max(100, width * 0.2)), bottom: 36, left: 40 };
    const x = d3.scaleUtc(d3.extent(weeks), [m.left, width - m.right]);
    const y = d3.scaleLinear([0, 1], [height - m.bottom, m.top]);
    const svg = d3.create('svg').attr('viewBox', `0 0 ${width} ${height}`).attr('width', '100%').attr('role', 'img').attr('aria-label', t('h_timeline'));
    svg.append('g').selectAll('line').data([0, .25, .5, .75, 1]).join('line').attr('x1', m.left).attr('x2', width - m.right).attr('y1', (v) => y(v)).attr('y2', (v) => y(v)).attr('stroke', (v) => (v === 0 ? css('--axis') : css('--grid')));
    svg.append('g').selectAll('text').data([0, .25, .5, .75, 1]).join('text').attr('x', m.left - 8).attr('y', (v) => y(v)).attr('dy', '0.32em').attr('text-anchor', 'end').attr('fill', css('--fg-muted')).attr('font-size', 11).text((v) => pct(v));
    const every = Math.ceil(weeks.length / Math.max(3, Math.floor((width - m.left - m.right) / 64)));
    svg.append('g').selectAll('text').data(weeks.filter((w, i) => i % every === 0)).join('text').attr('x', (w) => x(w)).attr('y', height - m.bottom + 18).attr('text-anchor', 'middle').attr('fill', css('--fg-muted')).attr('font-size', 11).text((w) => fmtDate(w.toISOString().slice(0, 10)));
    const line = d3.line().x((r) => x(r.date)).y((r) => y(r.v));
    for (const s of series) {
      svg.append('path').attr('d', line(s.rows)).attr('fill', 'none').attr('stroke', s.color).attr('stroke-width', 2).attr('stroke-linejoin', 'round').attr('stroke-linecap', 'round').attr('stroke-dasharray', s.dashed ? '6 4' : null);
    }
    // end markers and direct labels, nudged apart when they collide
    const ends = series.map((s) => ({ s, r: s.rows[s.rows.length - 1] })).map((e) => ({ ...e, ly: y(e.r.v) })).sort((a, b) => a.ly - b.ly);
    for (let i = 1; i < ends.length; i++) if (ends[i].ly - ends[i - 1].ly < 15) ends[i].ly = ends[i - 1].ly + 15;
    for (const e of ends) {
      svg.append('circle').attr('cx', x(e.r.date)).attr('cy', y(e.r.v)).attr('r', 4.5).attr('fill', e.s.color).attr('stroke', css('--panel')).attr('stroke-width', 2);
      svg.append('text').attr('x', x(e.r.date) + 10).attr('y', e.ly).attr('dy', '0.32em').attr('fill', css('--fg')).attr('font-size', 12).attr('font-weight', 600).text(short ? pct(e.r.v) : `${e.s.label} ${pct(e.r.v)}`);
    }
    // hover: crosshair + tooltip
    const cross = svg.append('line').attr('y1', m.top).attr('y2', height - m.bottom).attr('stroke', css('--axis')).attr('stroke-width', 1).style('display', 'none');
    const dots = svg.append('g').style('display', 'none');
    dots.selectAll('circle').data(series).join('circle').attr('r', 4).attr('fill', (s) => s.color).attr('stroke', css('--panel')).attr('stroke-width', 2);
    const tip = el('div', 'ca-tip'); tip.hidden = true;
    box.append(svg.node(), tip);
    const overlay = svg.append('rect').attr('x', m.left).attr('y', m.top).attr('width', width - m.left - m.right).attr('height', height - m.top - m.bottom).attr('fill', 'transparent').style('cursor', 'crosshair');
    const bisect = d3.bisector((d) => d).center;
    overlay.on('pointerenter pointermove', (ev) => {
      const [px] = d3.pointer(ev); const i = bisect(weeks, x.invert(px)); const w = weeks[i];
      cross.style('display', null).attr('x1', x(w)).attr('x2', x(w));
      dots.style('display', null).selectAll('circle').attr('cx', x(w)).attr('cy', (s) => y(s.rows[i].v));
      tip.hidden = false; tip.replaceChildren(el('div', 'ca-t0', `${t('week')} ${fmtDate(w.toISOString().slice(0, 10), true)}`));
      for (const s of series) {
        const row = el('div'); const sw = el('i'); sw.style.background = s.color;
        row.append(sw, `${s.label}: ${pct(s.rows[i].v)}${s.rows[i].sessions ? ` · ${s.rows[i].sessions} ${t('sessions')}` : ''}`); tip.append(row);
      }
      const scale = box.clientWidth / width;
      const left = Math.min(Math.max(x(w) * scale + 12, 0), box.clientWidth - tip.offsetWidth - 4);
      tip.style.left = left + 'px'; tip.style.top = Math.max(0, ev.offsetY - tip.offsetHeight - 12) + 'px';
    }).on('pointerleave', () => { tip.hidden = true; cross.style('display', 'none'); dots.style('display', 'none'); });

    // table twin
    const table = document.getElementById('ca-tl-table');
    const th = el('tr'); th.append(el('th', null, t('week')));
    for (const s of series) th.append(el('th', 'ca-num', s.label));
    table.tHead.replaceChildren(th); table.tBodies[0].replaceChildren();
    series[0].rows.forEach((r, i) => {
      const tr = el('tr'); tr.append(el('td', 'ca-wk', fmtDate(r.week, true)));
      for (const s of series) tr.append(el('td', 'ca-num', pct(s.rows[i].v)));
      table.tBodies[0].append(tr);
    });
  }

  // ---- part 1: one card per exam ---------------------------------------------
  function examCard(e) {
    const cov = share(e.id, e.field);
    const rows = D.syllabus.filter((r) => r.exam === e.id);
    const total = rows.reduce((a, r) => a + Number(r.weight), 0);
    const card = el('article', 'ca-card ca-exam ca-' + e.subject); card.id = 'exam-' + e.id;
    const head = el('div', 'ca-cardhead'); head.append(el('h3', null, t(e.title)), el('span', 'ca-big', pct(cov))); card.append(head);
    card.append(el('p', 'ca-note', t(e.note)), el('p', 'ca-examdate', examDateText(e.id)));
    const bar = el('div', 'ca-bar');
    for (const r of rows) { const seg = el('div', 'ca-seg ' + r.status); seg.style.width = (Number(r.weight) / total * 100) + '%'; seg.title = `${name(r)} · ${Number(r.weight)}%`; bar.append(seg); }
    card.append(bar);
    // what is still missing
    const left = remaining(e.id).filter((x) => x.row.status !== 'prepared' || e.field === 'coverage');
    const leftBox = el('div', 'ca-left');
    if (!left.length) leftBox.append(el('span', 'ca-left-l', t('left_none')));
    else {
      const sum = Math.round(left.reduce((a, x) => a + x.left, 0));
      leftBox.append(el('span', 'ca-left-l', t(e.field === 'prepared' ? 'left_label_prepared' : 'left_label') + ': '), el('span', null, left.map((x) => `${name(x.row)} (${Math.round(x.left)}%)`).join(' · ')), el('span', 'ca-left-sum', ' — ' + fmt('left_sum', { w: sum })));
    }
    card.append(leftBox);
    if (e.pace) {
      const p = pace(e.id), tot = totals();
      if (p) {
        const stale = e.subject === 'maths' && tot.maths_stale;
        card.append(el('p', 'ca-pace', stale ? fmt('pace_stale', { p: num(Math.round(p.perWeek * 1000) / 10), d: fmtDate(tot.maths_last, true) }) : fmt('pace', { p: num(Math.round(p.perWeek * 1000) / 10), n: p.weeksLeft })));
      }
    }
    // unit list with subtopic checklist
    card.append(el('h4', 'ca-h4', t('units_h')));
    const ul = el('ul', 'ca-units');
    for (const r of rows) {
      const li = el('li');
      const prefix = e.id === 'maths_p1' ? r.unit + ' ' : e.id === 'sat_math' ? '' : r.unit + '. ';
      const top = el('div', 'ca-urow'); top.append(el('span', 'ca-n', prefix + name(r)), el('span', 'ca-w', `${Number(r.weight)}% ${t('weight')}`), pill(r.status, t(r.status)));
      li.append(top);
      const meta = el('div', 'ca-umeta');
      if (e.id === 'sat_math') meta.textContent = window.caLang === 'vi' ? r.subtopic_list.split(' || ')[1] : r.subtopic_list.split(' || ')[0];
      else if (!r.sessions) meta.textContent = t('no_session');
      else meta.textContent = r.first_date === r.last_date ? fmt('taught_one', { n: r.sessions, a: fmtDate(r.first_date, true) }) : fmt('taught_span', { n: r.sessions, a: fmtDate(r.first_date, true), b: fmtDate(r.last_date, true) });
      li.append(meta);
      const subs = Array.isArray(r.subtopic_detail) ? r.subtopic_detail : [];
      if (subs.length > 1) {
        const chips = el('div', 'ca-chips');
        for (const s of subs) chips.append(el('span', 'ca-chip ' + (s.covered ? 'covered' : s.prepared ? 'prepared' : 'not_yet'), s.name));
        li.append(chips);
      }
      ul.append(li);
    }
    card.append(ul);
    if (e.id === 'econ_igcse') card.append(el('p', 'ca-note ca-bridge', t('n_bridge')));
    if (e.id === 'business_igcse' && D.materials.length) {
      card.append(el('h4', 'ca-h4', t('h_materials')));
      const mats = el('ul', 'ca-mats');
      for (const mt of D.materials) {
        const li = el('li'); const nm = el('span', 'ca-mtitle');
        if (mt.file && mt.status === 'ready') { const a = el('a', null, mt.title); a.href = mt.file; a.target = '_blank'; a.rel = 'noopener'; nm.append(a); } else nm.textContent = mt.title;
        li.append(el('span', 'ca-mnum', mt.session), nm, pill(mt.status, t(mt.status))); mats.append(li);
      }
      card.append(mats);
    }
    return card;
  }
  function fillExamCards() {
    const box = document.getElementById('ca-exam-cards'); box.replaceChildren();
    for (const e of EXAMS) box.append(examCard(e));
  }

  function fillPlan() {
    const tb = document.querySelector('#ca-plantable tbody');
    tb.replaceChildren();
    const lang = window.caLang;
    for (const r of D.plan) {
      const tr = el('tr');
      const td = (x, cls) => { const c = el('td', cls); typeof x === 'string' ? (c.textContent = x) : c.append(x); return c; };
      tr.append(td(fmtMonth(r.month), 'ca-wk'), td(pill(r.subject, subjName(r.subject))), td(lang === 'vi' ? r.planned_vi : r.planned_en), td(lang === 'vi' ? r.actual_vi : r.actual_en), td(pill(r.verdict, t(r.verdict))));
      tb.append(tr);
    }
  }

  // ---- part 2: weeks and sessions -------------------------------------------
  function drawWeekChart() {
    const box = document.getElementById('ca-weekchart');
    box.replaceChildren(); box.classList.remove('ca-skel');
    const rows = D.weekly.map((r) => ({ ...r, hours: Number(r.hours), sessions: Number(r.sessions) }));
    const weeks = [...new Set(rows.map((r) => r.week))].sort();
    const subs = SUBJECTS.filter((s) => rows.some((r) => r.subject === s && r.hours > 0));
    const width = Math.max(box.clientWidth || 600, 320), height = 240;
    const m = { top: 26, right: 8, bottom: 36, left: 40 };
    const x0 = d3.scaleBand(weeks, [m.left, width - m.right]).paddingInner(0.25).paddingOuter(0.1);
    const x1 = d3.scaleBand(subs, [0, x0.bandwidth()]).padding(0.1);
    const y = d3.scaleLinear([0, Math.max(1, d3.max(rows, (r) => r.hours))], [height - m.bottom, m.top]).nice();
    const svg = d3.create('svg').attr('viewBox', `0 0 ${width} ${height}`).attr('width', '100%').attr('role', 'img').attr('aria-label', t('h_weekchart'));
    svg.append('g').selectAll('line').data(y.ticks(4)).join('line').attr('x1', m.left).attr('x2', width - m.right).attr('y1', (v) => y(v)).attr('y2', (v) => y(v)).attr('stroke', css('--grid'));
    svg.append('g').selectAll('text').data(y.ticks(4)).join('text').attr('x', m.left - 8).attr('y', (v) => y(v)).attr('dy', '0.32em').attr('text-anchor', 'end').attr('fill', css('--fg-muted')).attr('font-size', 11).text((v) => v);
    svg.append('text').attr('x', m.left - 8).attr('y', m.top - 12).attr('text-anchor', 'end').attr('fill', css('--fg-muted')).attr('font-size', 10).text(t('hours'));
    const every = Math.ceil(weeks.length / Math.max(3, Math.floor((width - m.left) / 64)));
    svg.append('g').selectAll('text').data(weeks.filter((w, i) => i % every === 0)).join('text').attr('x', (w) => x0(w) + x0.bandwidth() / 2).attr('y', height - m.bottom + 18).attr('text-anchor', 'middle').attr('fill', css('--fg-muted')).attr('font-size', 11).text((w) => fmtDate(w));
    svg.append('line').attr('x1', m.left).attr('x2', width - m.right).attr('y1', y(0)).attr('y2', y(0)).attr('stroke', css('--axis'));
    const col = color();
    const bars = svg.append('g').selectAll('rect').data(rows.filter((r) => r.hours > 0 && subs.includes(r.subject))).join('rect')
      .attr('x', (r) => x0(r.week) + x1(r.subject)).attr('width', x1.bandwidth()).attr('y', (r) => y(r.hours)).attr('height', (r) => y(0) - y(r.hours)).attr('rx', 3).attr('fill', (r) => col[r.subject]);
    const tip = el('div', 'ca-tip'); tip.hidden = true;
    box.append(svg.node(), tip);
    bars.on('pointerenter pointermove', (ev, r) => {
      tip.hidden = false; tip.replaceChildren();
      const sw = el('i'); sw.style.background = col[r.subject];
      const l1 = el('div'); l1.append(sw, `${subjName(r.subject)}: ${num(r.hours)} ${t('hours')} · ${r.sessions} ${t('sessions')}`);
      const l2 = el('div', null, r.topics); l2.style.color = css('--fg-muted');
      tip.append(el('div', 'ca-t0', `${t('week')} ${fmtDate(r.week, true)}`), l1, l2);
      const px = Math.min(Math.max(ev.offsetX + 12, 0), box.clientWidth - tip.offsetWidth - 4);
      tip.style.left = px + 'px'; tip.style.top = Math.max(0, ev.offsetY - tip.offsetHeight - 10) + 'px';
    }).on('pointerleave', () => { tip.hidden = true; });
  }

  function lessonList(sessions) {
    const ul = el('ul', 'ca-lessons');
    for (const s of sessions) {
      const li = el('li');
      li.append(el('span', 'ca-ltitle', s.content));
      if (unitLabel(s)) li.append(el('span', 'ca-lunit', unitLabel(s)));
      li.append(pill('kind ' + s.kind, t(s.kind)));
      ul.append(li);
    }
    return ul;
  }

  function fillWeekTable() {
    const tb = document.querySelector('#ca-weektable tbody');
    tb.replaceChildren();
    const weeks = [...new Set(D.weekly.map((r) => r.week))].sort().reverse();
    for (const w of weeks) {
      const tr = el('tr');
      tr.append(el('td', 'ca-wk', fmtDate(w, true)));
      for (const sub of SUBJECTS) {
        const ss = D.sessions.filter((s) => s.week === w && s.subject === sub);
        const n = el('td', 'ca-num', String(ss.length));
        const c = el('td', 'ca-topic' + (ss.length ? '' : ' ca-empty'));
        if (ss.length) c.append(lessonList(ss)); else c.textContent = t('none');
        tr.append(n, c);
      }
      tb.append(tr);
    }
  }

  function fillLog() {
    const bar = document.getElementById('ca-log-filter'); bar.replaceChildren();
    for (const f of ['all', ...SUBJECTS]) {
      const b = el('button', 'ca-fbtn' + (f === 'all' ? '' : ' ca-' + f), t(f)); b.type = 'button'; b.setAttribute('aria-pressed', String(logFilter === f));
      b.addEventListener('click', () => { logFilter = f; fillLog(); }); bar.append(b);
    }
    const tb = document.querySelector('#ca-logtable tbody'); tb.replaceChildren();
    const rows = D.sessions.filter((s) => logFilter === 'all' || s.subject === logFilter).slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    for (const s of rows) {
      const tr = el('tr');
      const sub = el('td'); sub.append(pill(s.subject, subjName(s.subject)));
      const kind = el('td'); kind.append(pill('kind ' + s.kind, t(s.kind)));
      tr.append(el('td', 'ca-wk', fmtDate(s.date, true)), sub, el('td', 'ca-topic', s.content), el('td', unitLabel(s) ? null : 'ca-empty', unitLabel(s) || t('none')), kind,
        el('td', 'ca-num', s.hours ? num(Number(s.hours)) : '—'), el('td', 'ca-rec ' + s.recording, s.recording === 'yes' ? t('rec_yes') : t('rec_no')));
      tb.append(tr);
    }
  }

  // ---- part 3: observations ---------------------------------------------------
  function obsItem(o) {
    const lang = window.caLang;
    const li = el('li', 'ca-oitem');
    const meta = el('div', 'ca-meta'); meta.append(el('span', 'ca-odate', fmtDate(o.date, true)), pill(o.subject, subjName(o.subject)));
    li.append(meta, el('strong', 'ca-otitle', lang === 'vi' ? o.title_vi : o.title_en), el('p', 'ca-odetail', lang === 'vi' ? o.detail_vi : o.detail_en));
    if (o.response_vi || o.response_en) {
      const r = el('p', 'ca-resp'); r.append(el('b', null, t('response') + ': '), document.createTextNode(lang === 'vi' ? o.response_vi : o.response_en), document.createTextNode(' '));
      if (o.status) r.append(pill(o.status, t(o.status)));
      li.append(r);
    }
    return li;
  }
  function fillObservations() {
    const wrap = document.getElementById('ca-obs'); wrap.replaceChildren();
    for (const type of ['strength', 'weakness', 'improvement']) {
      const col = el('div', 'ca-col ' + type);
      const items = D.observations.filter((o) => o.type === type).sort((a, b) => (a.date < b.date ? 1 : -1));
      const ul = el('ul', 'ca-olist');
      items.forEach((o) => ul.append(obsItem(o)));
      col.append(el('h3', null, `${t(type)} (${items.length})`), ul); wrap.append(col);
    }
  }
  function fillAssessments() {
    const tb = document.querySelector('#ca-assess tbody'); tb.replaceChildren();
    const rows = D.sessions.filter((s) => s.kind === 'assessment').sort((a, b) => (a.date < b.date ? 1 : -1));
    for (const s of rows) {
      const tr = el('tr'); const sub = el('td'); sub.append(pill(s.subject, subjName(s.subject)));
      tr.append(el('td', 'ca-wk', fmtDate(s.date, true)), sub, el('td', 'ca-topic', s.content), el('td', 'ca-empty', s.score != null ? String(s.score) : t('score_na')));
      tb.append(tr);
    }
  }
  function fillEvaluation() {
    const box = document.getElementById('ca-eval');
    box.replaceChildren();
    for (const r of D.evaluation) {
      const row = el('div', 'ca-row');
      const max = r.max === null || r.max === '' ? null : Number(r.max);
      const track = el('div', 'ca-track'), fill = el('div', 'ca-fill');
      fill.style.width = max ? (Number(r.score) / max * 100) + '%' : '0%'; track.append(fill);
      if (!max) track.style.visibility = 'hidden';
      row.append(el('span', null, window.caLang === 'vi' ? r.item_vi : r.item_en), track, el('span', 'ca-num', max ? `${num(Number(r.score))}/${max}` : `${num(Number(r.score))} ${t('hours')}`));
      box.append(row);
    }
  }

  function render() {
    applyLabels();
    if (!D.sessions) return;
    fillTiles(); drawTimeline(); fillExamCards(); fillPlan(); drawWeekChart(); fillWeekTable(); fillLog(); fillObservations(); fillAssessments(); fillEvaluation();
  }

  document.getElementById('ca-lang-vi').addEventListener('click', () => { window.caLang = 'vi'; history.replaceState(null, '', location.pathname + location.search); render(); });
  document.getElementById('ca-lang-en').addEventListener('click', () => { window.caLang = 'en'; history.replaceState(null, '', location.pathname + location.search + '#en'); render(); });
  document.getElementById('ca-print').addEventListener('click', () => window.print());
  let raf = null;
  const redraw = () => { if (D.sessions) { drawTimeline(); drawWeekChart(); } };
  window.addEventListener('resize', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(redraw); });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', redraw);
  window.addEventListener('beforeprint', redraw); window.addEventListener('afterprint', redraw);

  if (location.hash === '#en') window.caLang = 'en'; // open the English version directly: …/#en
  applyLabels();
  Promise.all(FILES.map((f) => fetch(`data/${f}.json`, { cache: 'no-store' }).then((r) => { if (!r.ok) throw new Error(f + ' ' + r.status); return r.json(); }).then((j) => { D[f] = j; })))
    .then(render)
    .catch((e) => {
      const p = el('p', 'ca-error', t('load_error') + ' (' + e.message + ')');
      document.getElementById('ca-take').replaceWith(p);
      console.error(e);
    });
})();
