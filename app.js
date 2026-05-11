const CONFIG = {
  sheetId: '1DIPa8j42dNpE-6xneNwWAvRWgYATCXET',
  goal: 20000,
  currency: 'ILS',
  locale: 'he-IL',
  refreshSeconds: 60,
};

const $ = (id) => document.getElementById(id);

const fmtMoney = (n, opts = {}) =>
  new Intl.NumberFormat(CONFIG.locale, {
    style: 'currency',
    currency: CONFIG.currency,
    maximumFractionDigits: opts.decimals ?? 0,
    minimumFractionDigits: opts.decimals ?? 0,
  }).format(n);

const fmtNum = (n) => new Intl.NumberFormat(CONFIG.locale).format(Math.round(n));

const fmtDateShort = (d) =>
  new Intl.DateTimeFormat(CONFIG.locale, { day: 'numeric', month: 'short' }).format(d);

const fmtDateLong = (d) =>
  new Intl.DateTimeFormat(CONFIG.locale, { dateStyle: 'medium' }).format(d);

const fmtTime = (d) =>
  new Intl.DateTimeFormat(CONFIG.locale, { timeStyle: 'medium' }).format(d);

/* ---------- CSV ---------- */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c === '\r') { /* skip */ }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

async function fetchDonations() {
  const url = `https://docs.google.com/spreadsheets/d/${CONFIG.sheetId}/export?format=csv&cachebust=${Date.now()}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const [header, ...data] = rows;
  const idx = {
    type:   header.indexOf('סוג'),
    amount: header.indexOf('סכום'),
    date:   header.indexOf('תאריך'),
    notes:  header.indexOf('הערות'),
  };
  return data
    .filter((r) => r.length > 1 && (r[idx.type] || '').trim() === 'payment')
    .map((r) => ({
      amount: Number(String(r[idx.amount] || '').replace(/,/g, '')),
      date: new Date((r[idx.date] || '').trim().replace(' ', 'T')),
      note: (r[idx.notes] || '').trim(),
    }))
    .filter((d) => Number.isFinite(d.amount) && d.amount > 0);
}

/* ---------- Originality ---------- */
function originalityScore(amount) {
  if (amount % 1 !== 0) {
    const decimals = String(amount).split('.')[1]?.length || 0;
    return 1000 + decimals * 10;
  }
  if (amount % 5 !== 0)    return 500; // ends in 1,2,3,4,6,7,8,9
  if (amount % 10 !== 0)   return 200; // ends in 5
  if (amount % 100 !== 0)  return 100; // ends in 0 but not 00
  if (amount % 1000 !== 0) return 50;  // 100, 500
  return 0;                            // 1000+
}

function mostOriginal(donations) {
  const freq = new Map();
  for (const d of donations) freq.set(d.amount, (freq.get(d.amount) || 0) + 1);
  let best = donations[0];
  let bestScore = -Infinity;
  for (const d of donations) {
    const s = originalityScore(d.amount) + 1 / freq.get(d.amount);
    if (s > bestScore) { bestScore = s; best = d; }
  }
  return best;
}

/* ---------- Animations ---------- */
function animateNumber(el, from, to, durMs, formatter) {
  if (!Number.isFinite(from) || from === to) {
    el.textContent = formatter(to);
    return;
  }
  const start = performance.now();
  function step(now) {
    const t = Math.min(1, (now - start) / durMs);
    const eased = 1 - Math.pow(1 - t, 3);
    const val = from + (to - from) * eased;
    el.textContent = formatter(val);
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

/* ---------- Charts ---------- */
const charts = { cumulative: null, distribution: null };

function renderCumulative(donations) {
  const sorted = [...donations].sort((a, b) => a.date - b.date);
  let cum = 0;
  const points = sorted.map((d) => ({ x: d.date.getTime(), y: (cum += d.amount) }));
  if (points.length) {
    const start = new Date(sorted[0].date);
    start.setDate(start.getDate() - 1);
    points.unshift({ x: start.getTime(), y: 0 });
  }

  const canvas = $('cumulativeChart');
  const ctx = canvas.getContext('2d');
  charts.cumulative?.destroy();

  const gradient = ctx.createLinearGradient(0, 0, 0, 280);
  gradient.addColorStop(0, 'rgba(255,122,69,0.40)');
  gradient.addColorStop(1, 'rgba(255,122,69,0.00)');

  charts.cumulative = new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [{
        label: 'מצטבר',
        data: points,
        borderColor: '#d4a017',
        backgroundColor: gradient,
        fill: true,
        tension: 0.3,
        borderWidth: 3,
        pointRadius: 4,
        pointHoverRadius: 7,
        pointBackgroundColor: '#ff7a45',
        pointBorderColor: '#fff',
        pointBorderWidth: 2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          rtl: true,
          textDirection: 'rtl',
          backgroundColor: 'rgba(31,34,48,0.92)',
          padding: 10,
          titleFont: { family: 'Heebo', weight: '700' },
          bodyFont: { family: 'Heebo' },
          callbacks: {
            title: (items) => fmtDateLong(new Date(items[0].parsed.x)),
            label: (ctx) => fmtMoney(ctx.parsed.y),
          },
        },
      },
      scales: {
        x: {
          type: 'time',
          time: { unit: 'day' },
          ticks: {
            color: '#6b6f80',
            font: { family: 'Heebo' },
            maxRotation: 0,
            autoSkip: true,
            callback: function (val) { return fmtDateShort(new Date(val)); },
          },
          grid: { color: 'rgba(0,0,0,0.04)' },
        },
        y: {
          beginAtZero: true,
          ticks: {
            color: '#6b6f80',
            font: { family: 'Heebo' },
            callback: (v) => fmtMoney(v),
          },
          grid: { color: 'rgba(0,0,0,0.06)' },
        },
      },
    },
  });
}

function renderDistribution(donations) {
  const buckets = [
    { label: '1–50 ₪',     min: 1,    max: 50 },
    { label: '51–100 ₪',   min: 51,   max: 100 },
    { label: '101–250 ₪',  min: 101,  max: 250 },
    { label: '251–500 ₪',  min: 251,  max: 500 },
    { label: '501–1000 ₪', min: 501,  max: 1000 },
    { label: '1000+ ₪',    min: 1001, max: Infinity },
  ];
  const counts = buckets.map(
    (b) => donations.filter((d) => d.amount >= b.min && d.amount <= b.max).length
  );

  const canvas = $('distributionChart');
  charts.distribution?.destroy();
  charts.distribution = new Chart(canvas, {
    type: 'bar',
    data: {
      labels: buckets.map((b) => b.label),
      datasets: [{
        data: counts,
        backgroundColor: ['#ffe1bd', '#ffc99a', '#ffa776', '#ff7a45', '#e85d2a', '#b8400d'],
        borderRadius: 8,
        borderSkipped: false,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      indexAxis: 'y',
      plugins: {
        legend: { display: false },
        tooltip: {
          rtl: true,
          textDirection: 'rtl',
          backgroundColor: 'rgba(31,34,48,0.92)',
          padding: 10,
          titleFont: { family: 'Heebo', weight: '700' },
          bodyFont: { family: 'Heebo' },
          callbacks: { label: (ctx) => `${ctx.parsed.x} תרומות` },
        },
      },
      scales: {
        x: {
          beginAtZero: true,
          reverse: true,
          ticks: { color: '#6b6f80', font: { family: 'Heebo' }, precision: 0 },
          grid: { color: 'rgba(0,0,0,0.05)' },
        },
        y: {
          position: 'right',
          ticks: { color: '#1f2230', font: { family: 'Heebo', weight: '500' } },
          grid: { display: false },
        },
      },
    },
  });
}

/* ---------- Ticker ---------- */
function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function renderTicker(donations) {
  const seen = new Set();
  const items = [];
  for (const d of donations) {
    const n = d.note;
    if (!n) continue;
    if (seen.has(n)) continue;
    seen.add(n);
    items.push(n);
  }
  const track = $('tickerTrack');
  if (items.length === 0) {
    track.innerHTML = '<div class="ticker-item">תודה לכל התורמים 💛</div>';
    track.style.animation = 'none';
    return;
  }
  const html = items.map((t) => `<div class="ticker-item">${escapeHtml(t)}</div>`).join('');
  track.innerHTML = html + html;
  const duration = Math.max(30, items.length * 5);
  track.style.setProperty('--ticker-duration', `${duration}s`);
}

/* ---------- Render ---------- */
let lastTotal = 0;
let firstRender = true;

function render(donations) {
  if (donations.length === 0) {
    document.querySelectorAll('.stat-value').forEach((el) => (el.textContent = '—'));
    $('raised').textContent = fmtMoney(0);
    $('goal').textContent = fmtMoney(CONFIG.goal);
    $('progressFill').style.width = '0%';
    $('percent').textContent = '0%';
    renderTicker([]);
    return;
  }

  const amounts = donations.map((d) => d.amount);
  const total = amounts.reduce((a, b) => a + b, 0);
  const count = donations.length;
  const avg = total / count;
  const max = Math.max(...amounts);
  const min = Math.min(...amounts);
  const original = mostOriginal(donations);

  const startFrom = firstRender ? 0 : lastTotal;
  animateNumber($('raised'), startFrom, total, 1400, (v) => fmtMoney(v));
  animateNumber($('statTotal'), startFrom, total, 1400, (v) => fmtMoney(v));
  lastTotal = total;

  $('goal').textContent = fmtMoney(CONFIG.goal);
  const pct = Math.min(100, (total / CONFIG.goal) * 100);
  // Slight delay so the bar grows after numbers start ticking
  setTimeout(() => { $('progressFill').style.width = pct + '%'; }, 60);

  const startPct = firstRender ? 0 : Number($('percent').dataset.last || 0);
  animateNumber({
    set textContent(v) { $('percent').textContent = v; }
  }, startPct, pct, 1400, (v) => v.toFixed(1) + '%');
  $('percent').dataset.last = pct;

  $('statCount').textContent = fmtNum(count);
  $('statAvg').textContent = fmtMoney(avg);
  $('statMax').textContent = fmtMoney(max);
  $('statMin').textContent = fmtMoney(min);
  $('statOriginal').textContent = fmtMoney(original.amount, {
    decimals: Number.isInteger(original.amount) ? 0 : 2,
  });

  renderCumulative(donations);
  renderDistribution(donations);
  renderTicker(donations);

  $('updated').textContent = 'עודכן: ' + fmtTime(new Date());
  firstRender = false;
}

async function load() {
  try {
    const donations = await fetchDonations();
    render(donations);
  } catch (e) {
    $('updated').textContent = 'שגיאה בטעינה: ' + e.message;
    console.error(e);
  }
}

$('refreshBtn').addEventListener('click', load);
load();
setInterval(load, CONFIG.refreshSeconds * 1000);
