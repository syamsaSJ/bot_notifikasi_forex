// State Management
let allEventsData = [];
let activeFilter = 'all';
let searchQuery = '';

// DOM Elements
const container = document.getElementById('news-cards-container');
const searchInput = document.getElementById('search-input');
const filterBtns = document.querySelectorAll('.filter-btn');
const btnRefresh = document.getElementById('btn-refresh');
const countBuy = document.getElementById('count-buy');
const countSell = document.getElementById('count-sell');
const countTotal = document.getElementById('count-total');
const dateDisplay = document.getElementById('current-date-display');

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

// Fetch Live Economic News Data
async function fetchNewsData() {
  btnRefresh.classList.add('loading');
  try {
    const res = await fetch('/api/news');
    const data = await res.json();
    if (data && data.events) {
      allEventsData = data.events;
      renderDashboard();
    }
  } catch (err) {
    console.error('Failed to fetch live news:', err);
    // Render sample live preview if backend is loading
    allEventsData = getSamplePreviewData();
    renderDashboard();
  } finally {
    btnRefresh.classList.remove('loading');
  }
}

// Sample Preview Data for instant web preview
function getSamplePreviewData() {
  return [
    {
      event: 'Unemployment Claims',
      timeWIB: 'Kam, 1 Okt • 19.30 WIB',
      impact: 'medium',
      actual: '-',
      forecast: '201K',
      previous: '197K',
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
      signal: {
        signal: 'BUY',
        predictionText: 'USD melemah (data lebih buruk dari perkiraan). Hubungan terbalik emas & USD memproyeksikan XAU/USD menguat. Rekomendasi BUY.'
      }
    }
  ];
}

// Render Dashboard Metrics & Cards
function renderDashboard() {
  // Filter Data
  const filtered = allEventsData.filter(item => {
    const matchesImpact = activeFilter === 'all' || (item.impact || '').toLowerCase() === activeFilter;
    const matchesSearch = !searchQuery || (item.event || '').toLowerCase().includes(searchQuery.toLowerCase());
    return matchesImpact && matchesSearch;
  });

  // Calculate Summary Counts
  let buyCount = 0;
  let sellCount = 0;

  allEventsData.forEach(item => {
    const sig = item.signal ? item.signal.signal : 'HOLD';
    if (sig === 'BUY') buyCount++;
    if (sig === 'SELL') sellCount++;
  });

  countBuy.textContent = buyCount;
  countSell.textContent = sellCount;
  countTotal.textContent = allEventsData.length;

  // Set Date Display
  const now = new Date();
  const options = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' };
  dateDisplay.textContent = now.toLocaleDateString('id-ID', options);

  // Render Cards HTML
  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1; text-align: center; padding: 3rem; background: var(--card-bg); border-radius: 20px; border: 1px solid var(--card-border);">
        <i class="fa-solid fa-calendar-check" style="font-size: 3rem; color: var(--text-secondary); margin-bottom: 1rem;"></i>
        <h3>Tidak Ada Berita High/Medium Impact Currently</h3>
        <p style="color: var(--text-secondary); font-size: 0.9rem;">Gunakan tombol refresh untuk memperbarui data Forex Factory live.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(item => {
    const signalObj = item.signal || {};
    const signalType = signalObj.signal || 'HOLD';
    const predictionText = signalObj.predictionText || item.predictionText || 'Analisis korelasi fundamental XAU/USD.';
    const impactClass = (item.impact || 'medium').toLowerCase().includes('high') ? 'high' : 'medium';
    const impactLabel = impactClass === 'high' ? '🔴 HIGH' : '🟠 MEDIUM';

    const actDisp = item.actual && item.actual !== '' ? item.actual : '-';
    const foreDisp = item.forecast && item.forecast !== '' ? item.forecast : '-';
    const prevDisp = item.previous && item.previous !== '' ? item.previous : '-';

    return `
      <div class="signal-card">
        <div class="signal-card-header">
          <div class="event-info">
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
          <div class="title">PREDIKSI</div>
          <div class="body">${predictionText}</div>
        </div>

        <div class="card-action-bar">
          <span class="source-tag"><i class="fa-solid fa-globe"></i> Source: ForexFactory</span>
          <div class="action-btns">
            <button class="btn-icon" title="Copy Text" onclick="copyCardText('${escape(item.event)}', '${signalType}', '${escape(predictionText)}')">
              <i class="fa-regular fa-copy"></i>
            </button>
            <button class="btn-icon" title="Kirim Ke Telegram Channel">
              <i class="fa-paper-plane fa-solid"></i>
            </button>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// Copy Helper
window.copyCardText = function(eventRaw, signal, textRaw) {
  const event = unescape(eventRaw);
  const text = unescape(textRaw);
  const clipStr = `${event}\nSignal: ${signal}\n\nPREDIKSI:\n${text}`;
  navigator.clipboard.writeText(clipStr);
  alert('Teks notifikasi berhasil disalin!');
};

// Event Listeners
filterBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    filterBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    activeFilter = btn.dataset.filter;
    renderDashboard();
  });
});

searchInput.addEventListener('input', (e) => {
  searchQuery = e.target.value;
  renderDashboard();
});

btnRefresh.addEventListener('click', fetchNewsData);

// Init on Load
document.addEventListener('DOMContentLoaded', () => {
  initTradingView();
  fetchNewsData();
});
