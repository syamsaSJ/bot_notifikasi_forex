// State Management
let calendarEvents = [];
let investingNews = [];
let activeSource = 'all'; // 'all', 'calendar', 'investing'
let activeFilter = 'all'; // 'all', 'high', 'medium'
let searchQuery = '';

// DOM Elements
const container = document.getElementById('news-cards-container');
const searchInput = document.getElementById('search-input');
const filterBtns = document.querySelectorAll('.filter-btn');
const sourceBtns = document.querySelectorAll('.source-btn');
const btnRefresh = document.getElementById('btn-refresh');
const countBuy = document.getElementById('count-buy');
const countSell = document.getElementById('count-sell');
const countTotal = document.getElementById('count-total');
const dateDisplay = document.getElementById('current-date-display');
const systemStatus = document.getElementById('system-status');
const statusPill = document.getElementById('status-pill');
const toast = document.getElementById('toast');
const toastMessage = document.getElementById('toast-message');

// Initialize TradingView Live Widget
function initTradingView() {
  if (typeof TradingView !== 'undefined') {
    new TradingView.widget({
      "autosize": true,
      "symbol": "OANDA:XAUUSD",
      "interval": "60",
      "timezone": "Asia/Jakarta",
      "theme": "dark",
      "style": "1",
      "locale": "en",
      "toolbar_bg": "#15161C",
      "enable_publishing": false,
      "allow_symbol_change": true,
      "container_id": "tradingview_xauusd"
    });
  }
}

// Show Toast Notification
function showToast(message, isSuccess = true) {
  if (!toast || !toastMessage) return;
  toastMessage.textContent = message;
  toast.className = `toast ${isSuccess ? 'success' : 'error'} show`;
  setTimeout(() => {
    toast.className = 'toast hidden';
  }, 3500);
}

// Fetch Live Economic News & Investing Data
async function fetchNewsData() {
  if (btnRefresh) btnRefresh.classList.add('loading');
  if (systemStatus) systemStatus.textContent = 'CONNECTING...';

  try {
    const [resCalendar, resInvesting] = await Promise.allSettled([
      fetch('/api/news').then(r => r.json()),
      fetch('/api/investing').then(r => r.json())
    ]);

    let isConnected = false;

    if (resCalendar.status === 'fulfilled' && resCalendar.value && resCalendar.value.events) {
      calendarEvents = resCalendar.value.events;
      isConnected = true;
    } else {
      calendarEvents = getSampleCalendarData();
    }

    if (resInvesting.status === 'fulfilled' && resInvesting.value && resInvesting.value.news) {
      investingNews = resInvesting.value.news;
      isConnected = true;
    } else {
      investingNews = getSampleInvestingData();
    }

    if (isConnected) {
      if (systemStatus) systemStatus.textContent = 'CONNECTED & LIVE';
      if (statusPill) statusPill.className = 'status-pill live';
      showToast('✅ Terhubung! Data Forex Factory & Investing.com berhasil diperbarui.');
    } else {
      if (systemStatus) systemStatus.textContent = 'OFFLINE (PREVIEW MODE)';
      if (statusPill) statusPill.className = 'status-pill offline';
      showToast('⚠️ Gagal terhubung ke server. Menggunakan mode preview.', false);
    }

    renderDashboard();
  } catch (err) {
    console.error('Fetch news error:', err);
    calendarEvents = getSampleCalendarData();
    investingNews = getSampleInvestingData();
    if (systemStatus) systemStatus.textContent = 'PREVIEW MODE';
    renderDashboard();
  } finally {
    if (btnRefresh) btnRefresh.classList.remove('loading');
  }
}

// Sample Data Fallback
function getSampleCalendarData() {
  return [
    {
      event: 'Unemployment Claims',
      timeWIB: 'Kam, 1 Okt • 19.30 WIB',
      impact: 'medium',
      actual: '-',
      forecast: '201K',
      previous: '197K',
      source: 'Forex Factory',
      signal: {
        signal: 'BUY',
        predictionText: 'USD diperkirakan melemah (data lebih buruk). Hubungan terbalik emas & USD memproyeksikan XAU/USD menguat. Rekomendasi BUY.'
      }
    },
    {
      event: 'ISM Manufacturing PMI',
      timeWIB: 'Kam, 1 Okt • 21.00 WIB',
      impact: 'medium',
      actual: '-',
      forecast: '54.8',
      previous: '54.6',
      source: 'Forex Factory',
      signal: {
        signal: 'SELL',
        predictionText: 'USD diperkirakan menguat (data lebih baik). Hubungan terbalik emas & USD memproyeksikan XAU/USD melemah. Rekomendasi SELL.'
      }
    },
    {
      event: 'Non-Farm Employment Change (NFP)',
      timeWIB: 'Jum, 2 Okt • 19.30 WIB',
      impact: 'high',
      actual: '142K',
      forecast: '164K',
      previous: '114K',
      source: 'Forex Factory',
      signal: {
        signal: 'BUY',
        predictionText: 'USD melemah (data lebih buruk dari perkiraan). Hubungan terbalik emas & USD memproyeksikan XAU/USD menguat. Rekomendasi BUY.'
      }
    }
  ];
}

function getSampleInvestingData() {
  return [
    {
      title: 'Nasdaq 100 Hits Another Record as 10-Year Yield Holds at 5.3%',
      pubDate: 'Oct 06, 2026',
      timeWIB: 'Sel, 6 Okt • 13.50 WIB',
      category: 'Market Overview',
      source: 'Investing.com',
      analysis: {
        signal: 'SELL',
        impact: 'HIGH',
        direction: 'USD Menguat / Yield Surge ↓',
        impactText: 'Kenaikan imbal hasil obligasi 10-tahun menekan pergerakan Emas (XAU/USD). Rekomendasi SELL / Hati-hati tekanan jual.',
        recommendation: 'SELL XAU/USD'
      }
    },
    {
      title: 'Bitcoin and Gold Test Key Support: Who Holds the Line First?',
      pubDate: 'Oct 06, 2026',
      timeWIB: 'Sel, 6 Okt • 14.10 WIB',
      category: 'Komoditas & Emas',
      source: 'Investing.com',
      analysis: {
        signal: 'BUY',
        impact: 'HIGH',
        direction: 'USD Melemah / Gold Safe Haven ↑',
        impactText: 'Sentimen pasar safe haven meningkatkan daya tarik Emas di area support kuat. Rekomendasi BUY.',
        recommendation: 'BUY XAU/USD'
      }
    }
  ];
}

// Render Dashboard
function renderDashboard() {
  // Combine items
  let combinedItems = [];

  if (activeSource === 'all' || activeSource === 'calendar') {
    calendarEvents.forEach(item => combinedItems.push({ ...item, itemType: 'calendar' }));
  }

  if (activeSource === 'all' || activeSource === 'investing') {
    investingNews.forEach(item => combinedItems.push({ ...item, itemType: 'investing' }));
  }

  // Filter Items
  const filtered = combinedItems.filter(item => {
    // Impact filter
    let imp = 'medium';
    if (item.itemType === 'calendar') {
      imp = (item.impact || '').toLowerCase().includes('high') ? 'high' : 'medium';
    } else {
      imp = item.analysis && item.analysis.impact ? item.analysis.impact.toLowerCase() : 'medium';
    }

    const matchesImpact = activeFilter === 'all' || imp === activeFilter;
    const searchText = (item.event || item.title || '').toLowerCase();
    const matchesSearch = !searchQuery || searchText.includes(searchQuery.toLowerCase());

    return matchesImpact && matchesSearch;
  });

  // Calculate Metrics
  let buyCount = 0;
  let sellCount = 0;

  combinedItems.forEach(item => {
    let sig = 'HOLD';
    if (item.itemType === 'calendar') {
      sig = item.signal ? item.signal.signal : 'HOLD';
    } else {
      sig = item.analysis ? item.analysis.signal : 'NEUTRAL';
    }
    if (sig === 'BUY') buyCount++;
    if (sig === 'SELL') sellCount++;
  });

  if (countBuy) countBuy.textContent = buyCount;
  if (countSell) countSell.textContent = sellCount;
  if (countTotal) countTotal.textContent = combinedItems.length;

  // Set Date
  if (dateDisplay) {
    const now = new Date();
    dateDisplay.textContent = now.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  }

  // Render HTML
  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i class="fa-solid fa-calendar-check"></i>
        <h3>Tidak Ada Berita / Signals</h3>
        <p>Gunakan tombol refresh untuk memperbarui data Forex Factory & Investing.com live.</p>
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

// Render Forex Factory Calendar Card
function renderCalendarCard(item) {
  const signalObj = item.signal || {};
  const signalType = signalObj.signal || 'HOLD';
  const predictionText = signalObj.predictionText || 'Analisis korelasi fundamental XAU/USD.';
  const impactClass = (item.impact || 'medium').toLowerCase().includes('high') ? 'high' : 'medium';
  const impactLabel = impactClass === 'high' ? '🔴 HIGH' : '🟠 MEDIUM';

  const actDisp = item.actual && item.actual !== '' ? item.actual : '-';
  const foreDisp = item.forecast && item.forecast !== '' ? item.forecast : '-';
  const prevDisp = item.previous && item.previous !== '' ? item.previous : '-';

  return `
    <div class="signal-card calendar-card">
      <div class="signal-card-header">
        <div class="event-info">
          <span class="source-badge ff"><i class="fa-solid fa-calendar-days"></i> Forex Factory</span>
          <h3>${item.event}</h3>
          <span class="time-tag">${item.timeWIB || item.time || '19.30 WIB'}</span>
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
        <div class="title">PREDIKSI & ANALISIS</div>
        <div class="body">${predictionText}</div>
      </div>

      <div class="card-action-bar">
        <span class="source-tag"><i class="fa-solid fa-globe"></i> ForexFactory Calendar</span>
        <div class="action-btns">
          <button class="btn-icon" title="Salin Teks" onclick="copyCardText('${escape(item.event)}', '${signalType}', '${escape(predictionText)}')">
            <i class="fa-regular fa-copy"></i>
          </button>
        </div>
      </div>
    </div>
  `;
}

// Render Investing.com News & AI Sentiment Card
function renderInvestingCard(item) {
  const analysis = item.analysis || { signal: 'NEUTRAL', impact: 'MEDIUM', direction: 'Netral', impactText: 'Analisis pasar.' };
  const signalType = analysis.signal || 'NEUTRAL';
  const impactClass = (analysis.impact || 'medium').toLowerCase() === 'high' ? 'high' : 'medium';
  const impactLabel = impactClass === 'high' ? '🔴 HIGH SENTIMENT' : '🟠 MEDIUM SENTIMENT';

  return `
    <div class="signal-card investing-card">
      <div class="signal-card-header">
        <div class="event-info">
          <span class="source-badge inv"><i class="fa-solid fa-globe"></i> Investing.com • ${item.category || 'Forex'}</span>
          <h3 class="news-title">${item.title}</h3>
          <span class="time-tag">${item.timeWIB || 'Hari Ini'}</span>
        </div>
        <span class="impact-badge ${impactClass}">${impactLabel}</span>
      </div>

      <div class="metrics-row">
        <div class="signal-badge-card ${signalType}">${signalType}</div>
        <div class="metric-box wide">
          <span class="label">DAMPAK PASAR & KORELASI</span>
          <span class="value font-sm">${analysis.direction}</span>
        </div>
      </div>

      <div class="prediction-box investing-analysis">
        <div class="title">ANALISIS DAMPAK INVESTING</div>
        <div class="body">${analysis.impactText}</div>
      </div>

      <div class="card-action-bar">
        <a href="${item.link || '#'}" target="_blank" class="source-tag link"><i class="fa-solid fa-arrow-up-right-from-square"></i> Baca di Investing.com</a>
        <div class="action-btns">
          <button class="btn-icon" title="Salin Berita" onclick="copyCardText('${escape(item.title)}', '${signalType}', '${escape(analysis.impactText)}')">
            <i class="fa-regular fa-copy"></i>
          </button>
        </div>
      </div>
    </div>
  `;
}

// Copy Helper
window.copyCardText = function(eventRaw, signal, textRaw) {
  const event = unescape(eventRaw);
  const text = unescape(textRaw);
  const clipStr = `${event}\nSignal: ${signal}\n\nANALISIS:\n${text}`;
  navigator.clipboard.writeText(clipStr);
  showToast('📋 Teks notifikasi berhasil disalin!');
};

// Event Listeners
sourceBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    sourceBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeSource = btn.dataset.source;
    renderDashboard();
  });
});

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
  btnRefresh.addEventListener('click', fetchNewsData);
}

// Init on DOM Load
document.addEventListener('DOMContentLoaded', () => {
  initTradingView();
  fetchNewsData();
});
