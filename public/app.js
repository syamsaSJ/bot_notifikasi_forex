// State Management
let unifiedNewsEvents = [];
let activeSource = 'all'; // 'all', 'calendar', 'investing'
let activeTime = 'this_week'; // 'today', 'this_week', 'next_week', 'all'
let activeSort = 'dsc'; // 'dsc', 'asc'

let activeFilter = 'all'; // 'all', 'high', 'medium'
let searchQuery = '';

// DOM Elements
const container = document.getElementById('news-cards-container');
const searchInput = document.getElementById('search-input');
const filterBtns = document.querySelectorAll('.filter-btn');
const sourceBtns = document.querySelectorAll('.source-btn');
const timeSelect = document.getElementById('time-select');
const sortSelect = document.getElementById('sort-select');
const btnRefresh = document.getElementById('btn-refresh');
const countBuy = document.getElementById('count-buy');
const countSell = document.getElementById('count-sell');
const countTotal = document.getElementById('count-total');
const dateDisplay = document.getElementById('current-date-display');
const systemStatus = document.getElementById('system-status');
const statusPill = document.getElementById('status-pill');
const toast = document.getElementById('toast');
const toastMessage = document.getElementById('toast-message');

// Modal Scrape Logs Elements
const btnToggleLogs = document.getElementById('btn-toggle-logs');
const btnCloseLogs = document.getElementById('btn-close-logs');
const logsModal = document.getElementById('logs-modal');
const sourceHealthContainer = document.getElementById('source-health-container');
const scrapeLogsList = document.getElementById('scrape-logs-list');

// Initialize TradingView Widget
function initTradingView() {
  if (typeof TradingView !== 'undefined') {
    new TradingView.widget({
      "autosize": true,
      "symbol": "OANDA:XAUUSD",
      "interval": "5",
      "timezone": "Asia/Jakarta",
      "theme": "dark",
      "style": "1",
      "locale": "id",
      "toolbar_bg": "#15161C",
      "enable_publishing": false,
      "allow_symbol_change": true,
      "hide_side_toolbar": false,
      "container_id": "tradingview_xauusd"
    });
  }
}

function showToast(message, isSuccess = true) {
  if (!toast || !toastMessage) return;
  toastMessage.textContent = message;
  toast.className = `toast ${isSuccess ? 'success' : 'error'} show`;
  setTimeout(() => {
    toast.className = 'toast hidden';
  }, 3500);
}

// Fetch Unified Realtime News Feed
async function fetchNewsData(forceRefresh = false) {
  if (btnRefresh) btnRefresh.classList.add('loading');
  if (systemStatus) systemStatus.textContent = 'CONNECTING...';

  try {
    const url = forceRefresh ? '/api/news?refresh=true' : '/api/news';
    const res = await fetch(url);
    const data = await res.json();

    if (data && Array.isArray(data.events)) {
      unifiedNewsEvents = data.events;
      if (systemStatus) systemStatus.textContent = 'REALTIME XAU/USD';
      if (statusPill) statusPill.className = 'status-pill live';
      showToast(forceRefresh ? '⚡ Refreshed! Data Apify & Feed Ekonomi diperbarui.' : '✅ Feed berita & sinyal khusus pergerakan XAU/USD GOLD diperbarui!');
    } else {
      unifiedNewsEvents = [];
      if (systemStatus) systemStatus.textContent = 'NO DATA';
    }


    const lastUpdateTimeEl = document.getElementById('last-update-time');
    if (lastUpdateTimeEl) {
      const nowStr = new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', second: '2-digit' });
      lastUpdateTimeEl.textContent = `${nowStr} WIB`;
    }

    renderDashboard();
    fetchScrapeLogs();
  } catch (err) {
    console.error('Fetch news error:', err);
    if (systemStatus) systemStatus.textContent = 'OFFLINE MODE';
    if (statusPill) statusPill.className = 'status-pill offline';
    showToast('⚠️ Gagal terhubung ke server berita.', false);
  } finally {
    if (btnRefresh) btnRefresh.classList.remove('loading');
  }
}


// Fetch Scraping Health & Log Errors
async function fetchScrapeLogs() {
  try {
    const res = await fetch('/api/scrape-logs');
    const data = await res.json();

    if (data && sourceHealthContainer) {
      const healthObj = data.health || {};
      const keys = Object.keys(healthObj);

      if (keys.length === 0) {
        sourceHealthContainer.innerHTML = '<div class="health-item">Belum ada aktivitas scraper.</div>';
      } else {
        sourceHealthContainer.innerHTML = keys.map(k => {
          const s = healthObj[k];
          const isOk = s.status === 'OK';
          return `
            <div class="health-card ${isOk ? 'ok' : 'err'}">
              <div class="health-title">
                <i class="fa-solid ${isOk ? 'fa-circle-check color-emerald' : 'fa-triangle-exclamation color-red'}"></i>
                <strong>${k}</strong>
              </div>
              <div class="health-meta">
                <span>Status: <b>${s.status}</b></span>
                <span>Jumlah: <b>${s.itemCount} items</b></span>
                <span>WIB: ${s.lastCheckWIB || '-'}</span>
              </div>
              ${s.lastError ? `<div class="health-error">${s.lastError}</div>` : ''}
            </div>
          `;
        }).join('');
      }
    }

    if (data && Array.isArray(data.logs) && scrapeLogsList) {
      if (data.logs.length === 0) {
        scrapeLogsList.innerHTML = '<div class="log-item empty">Tidak ada log error scraping. All systems running smooth.</div>';
      } else {
        scrapeLogsList.innerHTML = data.logs.map(l => `
          <div class="log-item ${l.success ? 'success' : 'error'}">
            <span class="log-time">[${l.timeWIB}]</span>
            <span class="log-source">[${l.source}]</span>
            <span class="log-msg">${l.error ? l.error : `Sukses mengambil ${l.itemCount} berita`}</span>
          </div>
        `).join('');
      }
    }
  } catch (err) {
    console.error('Fetch scrape logs error:', err);
  }
}

// Render Main Dashboard
function renderDashboard() {
  // 1. Source Filtering
  let filtered = unifiedNewsEvents.filter(item => {
    if (activeSource === 'calendar' && item.itemType !== 'calendar') return false;
    if (activeSource === 'tradingview') {
      const src = (item.source || '').toLowerCase();
      const cat = (item.category || '').toLowerCase();
      return src.includes('tradingview') || cat.includes('tradingview');
    }
    if (activeSource === 'investing' && item.itemType !== 'investing') return false;
    return true;
  });

  // 2. Time Filtering (Today vs This Week vs Next Week vs All)
  const now = new Date();
  const dateStrWIB = now.toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' });
  const [y, m, d] = dateStrWIB.split('-').map(Number);
  const todayUtc = new Date(Date.UTC(y, m - 1, d));
  const dayOfWeek = todayUtc.getUTCDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
  const diffToMonday = (dayOfWeek === 0 ? -6 : 1 - dayOfWeek);

  const mondayThisWeekUtc = new Date(todayUtc);
  mondayThisWeekUtc.setUTCDate(todayUtc.getUTCDate() + diffToMonday);

  const sundayThisWeekUtc = new Date(mondayThisWeekUtc);
  sundayThisWeekUtc.setUTCDate(mondayThisWeekUtc.getUTCDate() + 6);

  const startThisWeekStr = mondayThisWeekUtc.toISOString().split('T')[0];
  const endThisWeekStr = sundayThisWeekUtc.toISOString().split('T')[0];
  const mondayThisWeekTs = mondayThisWeekUtc.getTime();
  const sundayThisWeekTsEnd = sundayThisWeekUtc.getTime() + 86399999;

  // Next Week Date Range
  const mondayNextWeekUtc = new Date(mondayThisWeekUtc);
  mondayNextWeekUtc.setUTCDate(mondayThisWeekUtc.getUTCDate() + 7);

  const sundayNextWeekUtc = new Date(mondayNextWeekUtc);
  sundayNextWeekUtc.setUTCDate(mondayNextWeekUtc.getUTCDate() + 6);

  const startNextWeekStr = mondayNextWeekUtc.toISOString().split('T')[0];
  const endNextWeekStr = sundayNextWeekUtc.toISOString().split('T')[0];
  const mondayNextWeekTs = mondayNextWeekUtc.getTime();
  const sundayNextWeekTsEnd = sundayNextWeekUtc.getTime() + 86399999;

  if (activeTime === 'today') {
    filtered = filtered.filter(item => {
      const itemDate = item.date || '';
      const itemTimeWIB = item.timeWIB || '';
      return itemDate === dateStrWIB || itemTimeWIB.includes('Hari Ini');
    });
  } else if (activeTime === 'this_week' || activeTime === 'weekly') {
    filtered = filtered.filter(item => {
      const itemDate = item.date || '';
      if (itemDate && /^\d{4}-\d{2}-\d{2}$/.test(itemDate)) {
        return itemDate >= startThisWeekStr && itemDate <= endThisWeekStr;
      }
      const itemTimestamp = item.timestamp || 0;
      return itemTimestamp >= mondayThisWeekTs && itemTimestamp <= sundayThisWeekTsEnd;
    });
  } else if (activeTime === 'next_week') {
    filtered = filtered.filter(item => {
      const itemDate = item.date || '';
      if (itemDate && /^\d{4}-\d{2}-\d{2}$/.test(itemDate)) {
        return itemDate >= startNextWeekStr && itemDate <= endNextWeekStr;
      }
      const itemTimestamp = item.timestamp || 0;
      return itemTimestamp >= mondayNextWeekTs && itemTimestamp <= sundayNextWeekTsEnd;
    });
  }

  // 3. Impact Filtering
  if (activeFilter !== 'all') {
    filtered = filtered.filter(item => {
      let imp = (item.impact || item.analysis?.impact || 'medium').toLowerCase();
      return imp.includes(activeFilter);
    });
  }

  // 4. Search Query Filter
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter(item => {
      const text = (item.event || item.title || '').toLowerCase();
      return text.includes(q);
    });
  }

  // 5. Sorting (DSC = Terbaru ke Terlama, ASC = Terlama ke Terbaru)
  if (activeSort === 'asc') {
    filtered.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  } else {
    filtered.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  }

  // Calculate Sinyal Metrics
  let buyCount = 0;
  let sellCount = 0;

  unifiedNewsEvents.forEach(item => {
    const sig = item.signal ? item.signal.signal : item.analysis ? item.analysis.signal : 'HOLD';
    if (sig === 'BUY') buyCount++;
    if (sig === 'SELL') sellCount++;
  });

  if (countBuy) countBuy.textContent = buyCount;
  if (countSell) countSell.textContent = sellCount;
  if (countTotal) countTotal.textContent = unifiedNewsEvents.length;

  if (dateDisplay) {
    const now = new Date();
    dateDisplay.textContent = now.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Jakarta' }) + ' (WIB)';
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-coins color-gold"></i>
        <h3>Tidak Ada Berita / Sinyal XAU/USD Gold Sesuai Filter</h3>
        <p>Seluruh berita telah difilter khusus yang berdampak pada pergerakan Emas & USD. Klik "Semua Terbaru" untuk melihat rilis minggu ini.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(item => {
    if (item.itemType === 'calendar') {
      return renderCalendarCard(item);
    } else {
      return renderInvestingCard(item);
    }
  }).join('');
}

function renderCalendarCard(item) {
  const signalObj = item.signal || {};
  const signalType = signalObj.signal || 'HOLD';
  const predictionText = signalObj.predictionText || 'Analisis fundamental XAU/USD.';
  const rawImpact = (item.impact || 'medium').toLowerCase();
  const impactClass = rawImpact.includes('high') ? 'high' : rawImpact.includes('medium') ? 'medium' : 'low';
  const impactLabel = impactClass === 'high' ? '🔴 HIGH' : impactClass === 'medium' ? '🟠 MEDIUM' : '🟡 LOW';

  const actDisp = item.actual && item.actual !== '' ? item.actual : '-';
  const foreDisp = item.forecast && item.forecast !== '' ? item.forecast : '-';
  const prevDisp = item.previous && item.previous !== '' ? item.previous : '-';

  const rawTimeStr = item.timeWIB || item.time || '-';
  const displayTime = rawTimeStr.replace(/All Day|All-Day|Tentative|TBD/gi, '-');

  return `
    <div class="signal-card calendar-card">
      <div class="signal-card-header">
        <div class="event-info">
          <span class="source-badge ff"><i class="fa-solid fa-coins color-gold"></i> XAU/USD GOLD • ${item.source || 'Forex Factory'}</span>
          <h3>${item.event || item.title}</h3>
          <span class="time-tag"><i class="fa-regular fa-clock"></i> ${displayTime}</span>
        </div>
        <span class="impact-badge ${impactClass}">${impactLabel}</span>
      </div>

      <div class="metrics-row">
        <div class="signal-badge-card ${signalType}">${signalType}</div>
        <div class="metric-box">
          <span class="label">ACTUAL</span>
          <span class="value">${actDisp}</span>
        </div>
        <div class="metric-box">
          <span class="label">FORECAST</span>
          <span class="value">${foreDisp}</span>
        </div>
        <div class="metric-box">
          <span class="label">PREVIOS</span>
          <span class="value">${prevDisp}</span>
        </div>
      </div>

      <div class="prediction-box">
        <div class="title">PREDIKSI & KORELASI EMAS</div>
        <div class="body">${predictionText}</div>
      </div>

      <div class="card-action-bar">
        <span class="source-tag"><i class="fa-solid fa-globe"></i> Kalender Ekonomi US</span>
        <button class="btn-icon" title="Salin Teks" onclick="copyCardText('${escape(item.event || item.title)}', '${signalType}', '${escape(predictionText)}')">
          <i class="fa-regular fa-copy"></i> Salin
        </button>
      </div>
    </div>
  `;
}

function renderInvestingCard(item) {
  const analysis = item.analysis || { signal: 'NEUTRAL', impact: 'MEDIUM', direction: 'Sentimen Emas', impactText: 'Analisis berita pasar.' };
  const signalType = analysis.signal || 'HOLD';
  const rawImpact = (analysis.impact || item.impact || 'medium').toLowerCase();
  const impactClass = rawImpact.includes('high') ? 'high' : rawImpact.includes('medium') ? 'medium' : 'low';
  const impactLabel = impactClass === 'high' ? '🔴 HIGH IMPACT' : impactClass === 'medium' ? '🟠 MEDIUM IMPACT' : '🟡 LOW IMPACT';

  return `
    <div class="signal-card investing-card">
      <div class="signal-card-header">
        <div class="event-info">
          <span class="source-badge inv"><i class="fa-solid fa-coins color-gold"></i> XAU/USD GOLD • ${item.source || 'Investing.com'}</span>
          <h3 class="news-title">${item.title}</h3>
          <span class="time-tag"><i class="fa-regular fa-clock"></i> ${item.timeWIB || 'Hari Ini (WIB)'}</span>
        </div>
        <span class="impact-badge ${impactClass}">${impactLabel}</span>
      </div>

      <div class="metrics-row">
        <div class="signal-badge-card ${signalType}">${signalType}</div>
        <div class="metric-box wide">
          <span class="label">PROYEKSI PERGERAKAN EMAS</span>
          <span class="value font-sm">${analysis.direction}</span>
        </div>
      </div>

      <div class="prediction-box investing-analysis">
        <div class="title">ANALISIS SENTIMEN PASAR</div>
        <div class="body">${analysis.impactText}</div>
      </div>

      <div class="card-action-bar">
        <a href="${item.link || '#'}" target="_blank" class="source-tag link"><i class="fa-solid fa-arrow-up-right-from-square"></i> Baca Sumber Berita</a>
        <button class="btn-icon" title="Salin Berita" onclick="copyCardText('${escape(item.title)}', '${signalType}', '${escape(analysis.impactText)}')">
          <i class="fa-regular fa-copy"></i> Salin
        </button>
      </div>
    </div>
  `;
}

window.copyCardText = function (eventRaw, signal, textRaw) {
  const event = unescape(eventRaw);
  const text = unescape(textRaw);
  const clipStr = `${event}\nSinyal XAU/USD: ${signal}\n\nPREDIKSI & ANALISIS:\n${text}`;
  navigator.clipboard.writeText(clipStr);
  showToast('📋 Teks notifikasi disalin!');
};

// Web Audio API Audio Chime Synthesizer (0 Delay Alert Sound)
function playFastReleaseSound(signal = 'BUY') {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (signal === 'BUY') {
      osc.frequency.setValueAtTime(880, ctx.currentTime); // A5 note
      osc.frequency.exponentialRampToValueAtTime(1760, ctx.currentTime + 0.3); // A6 note
    } else if (signal === 'SELL') {
      osc.frequency.setValueAtTime(600, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(300, ctx.currentTime + 0.3);
    } else {
      osc.frequency.setValueAtTime(523, ctx.currentTime);
    }

    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);

    osc.start();
    osc.stop(ctx.currentTime + 0.4);
  } catch (e) {
    console.warn('Audio alert disabled:', e);
  }
}

// Banner Overlay di atas TradingView Chart
window.hideFastReleaseBanner = function () {
  const banner = document.getElementById('fast-release-banner');
  if (banner) banner.classList.add('hidden');
};

function showFastReleaseBanner(item) {
  const banner = document.getElementById('fast-release-banner');
  const bannerTime = document.getElementById('fast-release-time');
  const bannerSignal = document.getElementById('fast-release-signal');
  const bannerTitle = document.getElementById('fast-release-title');
  const bannerDesc = document.getElementById('fast-release-desc');
  const chartWrapper = document.getElementById('chart-card-wrapper');

  if (!banner) return;

  const sig = item.signal ? item.signal.signal : (item.analysis ? item.analysis.signal : 'NEUTRAL');
  const title = item.event || item.title || 'Rilis Berita Baru';
  const desc = item.analysis ? item.analysis.impactText : (item.signal ? item.signal.predictionText : 'Analisis fundamental XAU/USD.');

  if (bannerTime) bannerTime.textContent = item.timeWIB || new Date().toLocaleTimeString('id-ID', { timeZone: 'Asia/Jakarta' }) + ' WIB';
  if (bannerSignal) {
    bannerSignal.textContent = sig;
    bannerSignal.className = `banner-signal-badge ${sig}`;
  }
  if (bannerTitle) bannerTitle.textContent = title;
  if (bannerDesc) bannerDesc.textContent = desc;

  banner.classList.remove('hidden');

  // Flash border pada TradingView chart container
  if (chartWrapper) {
    chartWrapper.classList.remove('flash-buy', 'flash-sell');
    chartWrapper.classList.add(sig === 'BUY' ? 'flash-buy' : sig === 'SELL' ? 'flash-sell' : 'flash-buy');
    setTimeout(() => {
      chartWrapper.classList.remove('flash-buy', 'flash-sell');
    }, 6000);
  }

  playFastReleaseSound(sig);
}

// Init SSE EventSource (0 Delay Realtime Push)
function initRealtimeSSE() {
  try {
    const evtSource = new EventSource('/api/stream');

    evtSource.addEventListener('NEWS_RELEASE', (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload && payload.item) {
          const item = payload.item;
          console.log('⚡ 0-DELAY SSE RELEASE RECEIVED:', item);

          // Cek apakah item sudah ada untuk menghindari duplikat
          const exists = unifiedNewsEvents.some(e => e.id === item.id || (e.title === item.title && e.date === item.date));
          if (!exists) {
            unifiedNewsEvents.unshift(item);
            renderDashboard();
            showToast(`⚡ RELEASE BARU: ${item.event || item.title}`, true);
          }
        }
      } catch (e) {
        console.error('SSE parse error:', e);
      }
    });

    evtSource.onopen = () => {
      console.log('⚡ SSE Stream Terhubung (0 Delay Active)');
      if (systemStatus) systemStatus.textContent = '⚡ 0-DELAY SSE CONNECTED';
      if (statusPill) statusPill.className = 'status-pill live';
    };

    evtSource.onerror = (err) => {
      console.warn('SSE Stream disconnected, retrying in background...', err);
    };
  } catch (e) {
    console.warn('SSE not supported, falling back to 30s polling:', e);
  }
}

// Event Listeners for Filters
sourceBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    sourceBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeSource = btn.dataset.source;
    renderDashboard();
  });
});

if (timeSelect) {
  timeSelect.addEventListener('change', (e) => {
    activeTime = e.target.value;
    renderDashboard();
  });
}

if (sortSelect) {
  sortSelect.addEventListener('change', (e) => {
    activeSort = e.target.value;
    renderDashboard();
  });
}

filterBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    filterBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeFilter = btn.dataset.filter;
    renderDashboard();
  });
});

if (searchInput) {
  searchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value;
    renderDashboard();
  });
}

if (btnRefresh) {
  btnRefresh.addEventListener('click', () => fetchNewsData(true));
}


// Scraper Logs Modal Listeners
if (btnToggleLogs && logsModal) {
  btnToggleLogs.addEventListener('click', () => {
    logsModal.classList.remove('hidden');
    fetchScrapeLogs();
  });
}

if (btnCloseLogs && logsModal) {
  btnCloseLogs.addEventListener('click', () => {
    logsModal.classList.add('hidden');
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initTradingView();
  fetchNewsData();
  initRealtimeSSE();
  setInterval(fetchNewsData, 30000);
});
