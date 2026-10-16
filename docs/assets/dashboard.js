/* Châu Anh Progress — static dashboard. Loads data/*.json (written by build.py) and renders every section. */
(() => {
  const FILES = ['sessions', 'weekly', 'syllabus', 'materials', 'observations', 'plan', 'evaluation', 'meta'];
  const SUBJECTS = ['maths', 'econ', 'business'];
  const D = {};
  const T = () => window.caT[window.caLang];
  const t = (k) => T()[k] ?? k;
  const pct = d3.format('.0%');
  const num = (v) => (Number.isInteger(v) ? String(v) : d3.format('.1f')(v));
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const color = () => ({ maths: css('--maths'), econ: css('--econ'), business: css('--business') });

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
  function coverage() {
    const share = (exam, field) => {
      const rows = D.syllabus.filter((r) => r.exam === exam);
      const w = rows.reduce((a, r) => a + Number(r.weight), 0);
      return w ? rows.reduce((a, r) => a + Number(r.weight) * Number(r[field] || 0), 0) / w : 0;
    };
    const econ = D.syllabus.filter((r) => r.exam === 'econ_igcse');
    const bus = D.syllabus.filter((r) => r.exam === 'business_igcse');
    return {
      maths_p1: share('maths_p1', 'coverage'), econ_igcse: share('econ_igcse', 'coverage'), sat_math: share('sat_math', 'coverage'),
      business_taught: share('business_igcse', 'coverage'), business_prepared: share('business_igcse', 'prepared'),
      econ_subtopics: `${econ.reduce((a, r) => a + Number(r.subtopics_covered), 0)}/${econ.reduce((a, r) => a + Number(r.subtopics), 0)}`,
      business_subtopics: `${bus.reduce((a, r) => a + Number(r.subtopics_prepared), 0)}/${bus.reduce((a, r) => a + Number(r.subtopics), 0)}`,
    };
  }

  // ---- sections -----------------------------------------------------------
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
    set('coverage.maths_p1', pct(cov.maths_p1));
    set('coverage.econ_igcse', pct(cov.econ_igcse));
    set('coverage.sat_math', pct(cov.sat_math));
    set('coverage.business_prepared', pct(cov.business_prepared));
    set('coverage.econ_subtopics', cov.econ_subtopics);
    set('coverage.business_subtopics', cov.business_subtopics);
    document.getElementById('ca-take').textContent = T().take(
      { ...tot, last_long: fmtDate(tot.last, true), maths_last_long: fmtDate(tot.maths_last, true) },
      { maths_p1: pct(cov.maths_p1), econ_igcse: pct(cov.econ_igcse), business_prepared: pct(cov.business_prepared) });
    const gen = D.meta && D.meta.generated ? new Date(D.meta.generated) : null;
    document.getElementById('ca-updated').textContent = gen ? gen.toLocaleString(window.caLang === 'vi' ? 'vi-VN' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
  }

  function drawWeekChart() {
    const box = document.getElementById('ca-weekchart');
    box.replaceChildren(); box.classList.remove('ca-skel');
    const rows = D.weekly.map((r) => ({ ...r, hours: Number(r.hours), sessions: Number(r.sessions) }));
    const weeks = [...new Set(rows.map((r) => r.week))].sort();
    const subs = SUBJECTS.filter((s) => rows.some((r) => r.subject === s && r.hours > 0));
    const width = Math.max(box.clientWidth || 600, 320), height = 260;
    const m = { top: 14, right: 8, bottom: 40, left: 36 };
    const x0 = d3.scaleBand(weeks, [m.left, width - m.right]).paddingInner(0.25).paddingOuter(0.1);
    const x1 = d3.scaleBand(subs, [0, x0.bandwidth()]).padding(0.08);
    const y = d3.scaleLinear([0, Math.max(1, d3.max(rows, (r) => r.hours))], [height - m.bottom, m.top]).nice();
    const svg = d3.create('svg').attr('viewBox', `0 0 ${width} ${height}`).attr('width', '100%').attr('role', 'img');
    svg.append('g').selectAll('line').data(y.ticks(4)).join('line').attr('x1', m.left).attr('x2', width - m.right).attr('y1', (v) => y(v)).attr('y2', (v) => y(v)).attr('stroke', css('--grid'));
    svg.append('g').selectAll('text').data(y.ticks(4)).join('text').attr('x', m.left - 6).attr('y', (v) => y(v)).attr('dy', '0.32em').attr('text-anchor', 'end').attr('fill', css('--fg-muted')).attr('font-size', 11).text((v) => v);
    svg.append('text').attr('x', m.left - 6).attr('y', m.top - 4).attr('text-anchor', 'end').attr('fill', css('--fg-muted')).attr('font-size', 10).text(t('hours'));
    const every = Math.ceil(weeks.length / Math.max(3, Math.floor((width - m.left) / 64)));
    svg.append('g').selectAll('text').data(weeks.filter((w, i) => i % every === 0)).join('text').attr('x', (w) => x0(w) + x0.bandwidth() / 2).attr('y', height - m.bottom + 16).attr('text-anchor', 'middle').attr('fill', css('--fg-muted')).attr('font-size', 11).text((w) => fmtDate(w));
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

  function fillWeekTable() {
    const tb = document.querySelector('#ca-weektable tbody');
    tb.replaceChildren();
    const byWeek = {};
    for (const r of D.weekly) {
      const w = byWeek[r.week] || (byWeek[r.week] = { week: r.week });
      w[r.subject + '_sessions'] = Number(r.sessions); w[r.subject + '_topics'] = r.topics || '';
    }
    for (const r of Object.values(byWeek).sort((a, b) => (a.week < b.week ? 1 : -1))) {
      const tr = el('tr');
      tr.append(el('td', 'ca-wk', fmtDate(r.week, true)));
      for (const sub of SUBJECTS) {
        tr.append(el('td', 'ca-num', String(r[sub + '_sessions'] || 0)));
        tr.append(el('td', 'ca-topic' + (r[sub + '_topics'] ? '' : ' ca-empty'), r[sub + '_topics'] || t('none')));
      }
      tb.append(tr);
    }
  }

  function fillSyllabus() {
    const lang = window.caLang;
    for (const exam of ['maths_p1', 'econ_igcse', 'business_igcse', 'sat_math']) {
      const bar = document.getElementById('ca-bar-' + exam), ul = document.getElementById('ca-units-' + exam);
      bar.replaceChildren(); ul.replaceChildren();
      const rows = D.syllabus.filter((r) => r.exam === exam);
      const total = rows.reduce((a, r) => a + Number(r.weight), 0);
      for (const r of rows) {
        const seg = el('div', 'ca-seg ' + r.status); seg.style.width = (Number(r.weight) / total * 100) + '%';
        seg.title = (lang === 'vi' ? r.name_vi : r.name_en) + ' · ' + Number(r.weight) + '%';
        bar.append(seg);
        const li = el('li');
        const prefix = exam === 'maths_p1' ? r.unit + ' ' : exam === 'sat_math' ? '' : r.unit + '. ';
        const w = el('span', 'ca-w');
        if (exam === 'econ_igcse') w.textContent = `${r.subtopics_covered}/${r.subtopics} ${t('subtopics')} · ${Number(r.weight)}%`;
        else if (exam === 'business_igcse') w.textContent = `${r.subtopics_prepared}/${r.subtopics} ${t('prepared').toLowerCase()}${Number(r.subtopics_covered) ? ` · ${r.subtopics_covered}/${r.subtopics} ${t('covered').toLowerCase()}` : ''} · ${Number(r.weight)}%`;
        else w.textContent = `${Number(r.weight)}%`;
        li.append(el('span', 'ca-n', prefix + (lang === 'vi' ? r.name_vi : r.name_en)), w, pill(r.status, t(r.status)));
        ul.append(li);
      }
    }
    const mats = document.getElementById('ca-mats');
    mats.replaceChildren();
    for (const m of D.materials) {
      const li = el('li');
      const name = el('span', 'ca-mtitle');
      if (m.file && m.status === 'ready') { const a = el('a', null, m.title); a.href = m.file; a.target = '_blank'; a.rel = 'noopener'; name.append(a); } else name.textContent = m.title;
      li.append(el('span', 'ca-mnum', m.session), name, pill(m.status, t(m.status)));
      mats.append(li);
    }
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

  function obsCard(o) {
    const lang = window.caLang;
    const card = el('article', 'ca-item');
    const meta = el('div', 'ca-meta'); meta.append(pill(o.subject, subjName(o.subject)), document.createTextNode(fmtDate(o.date, true)));
    card.append(meta, el('div', 'ca-title', lang === 'vi' ? o.title_vi : o.title_en), el('div', 'ca-detail', lang === 'vi' ? o.detail_vi : o.detail_en));
    if (o.quote) card.append(el('blockquote', null, '“' + o.quote + '”'));
    if (o.response_vi || o.response_en) {
      const r = el('div', 'ca-resp'); r.append(el('b', null, t('response')), document.createTextNode(lang === 'vi' ? o.response_vi : o.response_en));
      if (o.status) r.append(pill(o.status, t(o.status)));
      card.append(r);
    }
    card.append(el('div', 'ca-src', o.source));
    return card;
  }

  function fillObservations() {
    const wrap = document.getElementById('ca-obs'), gaps = document.getElementById('ca-gap-items');
    wrap.replaceChildren(); gaps.replaceChildren();
    for (const type of ['strength', 'weakness', 'improvement']) {
      const col = el('div', 'ca-col ' + type);
      const items = el('div', 'ca-items');
      D.observations.filter((o) => o.type === type).sort((a, b) => (a.date < b.date ? -1 : 1)).forEach((o) => items.append(obsCard(o)));
      col.append(el('h3', null, t(type)), items); wrap.append(col);
    }
    D.observations.filter((o) => o.type === 'gap').forEach((o) => gaps.append(obsCard(o)));
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
      row.append(el('span', null, window.caLang === 'vi' ? r.item_vi : r.item_en), track, el('span', null, max ? `${num(Number(r.score))}/${max}` : `${num(Number(r.score))} ${t('hours')}`));
      box.append(row);
    }
  }

  function render() {
    applyLabels();
    if (!D.sessions) return;
    fillTiles(); drawWeekChart(); fillWeekTable(); fillSyllabus(); fillPlan(); fillObservations(); fillEvaluation();
  }

  document.getElementById('ca-lang-vi').addEventListener('click', () => { window.caLang = 'vi'; render(); });
  document.getElementById('ca-lang-en').addEventListener('click', () => { window.caLang = 'en'; render(); });
  let raf = null;
  window.addEventListener('resize', () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => D.sessions && drawWeekChart()); });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => D.sessions && drawWeekChart());

  applyLabels();
  Promise.all(FILES.map((f) => fetch(`data/${f}.json`, { cache: 'no-store' }).then((r) => { if (!r.ok) throw new Error(f + ' ' + r.status); return r.json(); }).then((j) => { D[f] = j; })))
    .then(render)
    .catch((e) => {
      const p = el('p', 'ca-error', t('load_error') + ' (' + e.message + ')');
      document.getElementById('ca-take').replaceWith(p);
      console.error(e);
    });
})();
