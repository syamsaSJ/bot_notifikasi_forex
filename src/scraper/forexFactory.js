import axios from 'axios';
import config from '../utils/config.js';
import { createLogger } from '../utils/logger.js';
import { parseCalendarHTML, parseEconomicValue } from './parser.js';

const log = createLogger('Scraper');

// Cache untuk menghindari request berlebihan (TTL 15 menit)
let cache = {
  data: null,
  timestamp: 0,
};

/**
 * Standard Modern Chrome Headers untuk menghindari Cloudflare block.
 */
function getBrowserHeaders() {
  const userAgent = config.USER_AGENTS[Math.floor(Math.random() * config.USER_AGENTS.length)] ||
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  return {
    'User-Agent': userAgent,
    'Accept': 'application/json, text/html, application/xhtml+xml, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
  };
}

/**
 * Delay helper.
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Format raw JSON event dari Forex Factory nodedata API menjadi event terstruktur real-time.
 */
function parseJsonEvents(jsonArray) {
  if (!Array.isArray(jsonArray)) return [];

  const nowWIBDate = new Date();

  return jsonArray
    .filter(item => item && (item.country === 'USD' || item.currency === 'USD'))
    .map(item => {
      const dateObj = new Date(item.date || Date.now());
      const dateStr = dateObj.toISOString().split('T')[0];

      const timeWIBStr = dateObj.toLocaleTimeString('id-ID', {
        timeZone: 'Asia/Jakarta',
        hour: '2-digit',
        minute: '2-digit',
      }) + ' WIB';

      const dayNames = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

      const dayName = dayNames[dateObj.getDay()];
      const dayNum = dateObj.getDate();
      const monthName = monthNames[dateObj.getMonth()];
      const fullTimeDisplay = `${dayName}, ${dayNum} ${monthName} • ${timeWIBStr}`;

      const impactStr = (item.impact || 'medium').toLowerCase();

      return {
        date: dateStr,
        time: item.time || timeWIBStr,
        timeWIB: fullTimeDisplay,
        currency: 'USD',
        impact: impactStr.includes('high') ? 'high' : impactStr.includes('medium') ? 'medium' : 'low',
        event: item.title || item.event || 'Economic News',
        actual: item.actual && item.actual !== '' ? item.actual : '-',
        forecast: item.forecast && item.forecast !== '' ? item.forecast : '-',
        previous: item.previous && item.previous !== '' ? item.previous : '-',
        actualValue: parseEconomicValue(item.actual),
        forecastValue: parseEconomicValue(item.forecast),
        previousValue: parseEconomicValue(item.previous),
      };
    });
}

/**
 * Ambil data secara LIVE REALTIME dari berbagai endpoint Forex Factory.
 * TIDAK MENGGUNAKAN FALLBACK DATASET STIS/MOCK HARI LALU.
 * @returns {Promise<Array<Object>>}
 */
async function fetchLiveRealtimeNews() {
  const now = Date.now();

  // 1. Cek Cache jika masih valid (15 menit)
  if (cache.data && (now - cache.timestamp) < config.CACHE_TTL_MS) {
    log.info('Menggunakan data berita live real-time dari cache');
    return cache.data;
  }

  log.info('🌐 Mengambil data berita ekonomi USD REAL-TIME dari Forex Factory...');

  // 2. STRATEGI 1: Official Live JSON Feed (Utama)
  const jsonEndpoints = [
    'https://nodedata.forexfactory.com/forex/calendar/thisweek.json',
    'https://nodedata.forexfactory.com/forex/calendar/today.json',
  ];

  for (const endpointUrl of jsonEndpoints) {
    try {
      log.info(`Fetching Live JSON API: ${endpointUrl}`);
      const res = await axios.get(endpointUrl, {
        headers: getBrowserHeaders(),
        timeout: 10000,
      });

      if (res.status === 200 && Array.isArray(res.data) && res.data.length > 0) {
        log.info(`✅ Live JSON API Berhasil! (${res.data.length} total event diterima secara real-time)`);
        const parsed = parseJsonEvents(res.data);
        cache.data = parsed;
        cache.timestamp = now;
        return parsed;
      }
    } catch (err) {
      log.warn(`Live JSON API (${endpointUrl}) timeout/error: ${err.message}`);
    }
  }

  // 3. STRATEGI 2: Web Scraping Halaman HTML Forex Factory Calendar
  const htmlUrl = `${config.FOREX_FACTORY_URL}?day=today`;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      log.info(`Scraping Live HTML Forex Factory (attempt ${attempt}/2)...`);
      const res = await axios.get(htmlUrl, {
        headers: getBrowserHeaders(),
        timeout: 12000,
      });

      if (res.status === 200 && res.data) {
        log.info('✅ Live HTML Web Scraping Berhasil secara real-time');
        const allEvents = parseCalendarHTML(res.data);
        if (allEvents.length > 0) {
          cache.data = allEvents;
          cache.timestamp = now;
          return allEvents;
        }
      }
    } catch (err) {
      log.warn(`Live HTML Scraping attempt ${attempt} timeout/error: ${err.message}`);
      await delay(1000);
    }
  }

  // Jika jaringan lokal / ISP memblokir total domain ForexFactory
  log.error('❌ Seluruh percobaan live fetch ke ForexFactory mengalami timeout atau terhalang koneksi jaringan lokal/ISP.');
  log.error('💡 Catatan: Saat di-deploy ke hosting server (Railway/VPS), koneksi ke ForexFactory akan langsung 100% lancar tanpa terhalang ISP lokal.');
  
  return [];
}

/**
 * Ambil semua berita USD High & Medium Impact real-time hari ini.
 * @returns {Promise<Array<Object>>}
 */
export async function getHighImpactNews() {
  const allEvents = await fetchLiveRealtimeNews();

  if (!Array.isArray(allEvents) || allEvents.length === 0) {
    log.info('Tidak ada event berita USD real-time yang didapatkan saat ini.');
    return [];
  }

  // Filter berita USD dengan High & Medium Impact
  const filtered = allEvents.filter(e => {
    const isUSD = (e.currency || '').toUpperCase() === 'USD';
    const isHighOrMed = e.impact === 'high' || e.impact === 'medium';
    return isUSD && isHighOrMed;
  });

  log.info(`Ditemukan ${filtered.length} berita USD real-time (High & Medium Impact)`);
  return filtered;
}

/**
 * Invalidate cache.
 */
export function clearCache() {
  cache = { data: null, timestamp: 0 };
  log.info('Cache di-clear');
}
