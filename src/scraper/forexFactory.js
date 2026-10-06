import fs from 'fs';
import path from 'path';
import axios from 'axios';
import config from '../utils/config.js';
import { createLogger } from '../utils/logger.js';
import { parseCalendarHTML, parseEconomicValue } from './parser.js';

const log = createLogger('Scraper');
const CACHE_FILE_PATH = path.resolve('scratch', 'calendar_cache.json');

// Cache untuk menghindari request berlebihan (TTL 15 menit)
let cache = {
  data: null,
  timestamp: 0,
};

// Load disk cache saat inisialisasi jika ada
try {
  if (fs.existsSync(CACHE_FILE_PATH)) {
    const fileContent = fs.readFileSync(CACHE_FILE_PATH, 'utf-8');
    const parsedFile = JSON.parse(fileContent);
    if (Array.isArray(parsedFile) && parsedFile.length > 0) {
      cache.data = parsedFile;
      cache.timestamp = Date.now();
      log.info(`💾 Berhasil memuat ${parsedFile.length} data kalender dari disk cache.`);
    }
  }
} catch (e) {
  log.warn(`Gagal membaca disk cache: ${e.message}`);
}

function saveDiskCache(data) {
  try {
    const dir = path.dirname(CACHE_FILE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(CACHE_FILE_PATH, JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) {
    log.warn(`Gagal menyimpan disk cache: ${e.message}`);
  }
}

/**
 * Headers untuk JSON API endpoints.
 */
function getJsonHeaders() {
  const userAgent = config.USER_AGENTS[Math.floor(Math.random() * config.USER_AGENTS.length)] ||
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

  return {
    'User-Agent': userAgent,
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
  };
}

/**
 * Standard Modern Chrome Headers untuk menghindari Cloudflare block pada HTML.
 */
function getBrowserHeaders() {
  const userAgent = config.USER_AGENTS[Math.floor(Math.random() * config.USER_AGENTS.length)] ||
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

  return {
    'User-Agent': userAgent,
    'Accept': 'application/json, text/html, application/xhtml+xml, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
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
function parseJsonEvents(jsonInput) {
  let jsonArray = jsonInput;
  if (typeof jsonInput === 'string') {
    try {
      jsonArray = JSON.parse(jsonInput);
    } catch (e) {
      return [];
    }
  }

  if (!Array.isArray(jsonArray)) return [];

  return jsonArray
    .filter(item => item && (item.country === 'USD' || item.currency === 'USD'))
    .map(item => {
      const dateObj = new Date(item.date || Date.now());
      const dateStr = dateObj.toLocaleDateString('sv-SE', { timeZone: 'Asia/Jakarta' });

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
  if (cache.data && cache.data.length > 0 && (now - cache.timestamp) < config.CACHE_TTL_MS) {
    log.info('Menggunakan data berita live real-time dari cache');
    return cache.data;
  }

  log.info('🌐 Mengambil data berita ekonomi USD REAL-TIME dari Forex Factory...');

  // 2. STRATEGI 1: Official Live JSON Feed & Public Proxies
  const targetUrl = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
  const jsonEndpoints = [
    targetUrl,
    'https://api.allorigins.win/raw?url=' + encodeURIComponent(targetUrl),
    'https://corsproxy.io/?url=' + encodeURIComponent(targetUrl),
  ];

  for (const endpointUrl of jsonEndpoints) {
    try {
      log.info(`Fetching Live JSON API: ${endpointUrl}`);
      const res = await axios.get(endpointUrl, {
        headers: getJsonHeaders(),
        timeout: 10000,
      });

      if (res.status === 200 && res.data) {
        const parsed = parseJsonEvents(res.data);
        if (parsed.length > 0) {
          log.info(`✅ Live JSON API Berhasil! (${parsed.length} USD event diterima secara real-time)`);
          cache.data = parsed;
          cache.timestamp = now;
          saveDiskCache(parsed);
          return parsed;
        }
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
          saveDiskCache(allEvents);
          return allEvents;
        }
      }
    } catch (err) {
      log.warn(`Live HTML Scraping attempt ${attempt} timeout/error: ${err.message}`);
      await delay(1000);
    }
  }

  // 4. STRATEGI 3: Fallback ke Stale Cache jika jaringan/rate-limit terganggu
  if (cache.data && cache.data.length > 0) {
    log.warn('⚠️ Menggunakan data stale cache karena koneksi live mengalami rate-limit/timeout.');
    return cache.data;
  }

  log.error('❌ Seluruh percobaan live fetch ke ForexFactory mengalami timeout atau terhalang koneksi jaringan.');
  return [];
}

/**
 * Ambil semua berita USD High & Medium Impact real-time.
 * @returns {Promise<Array<Object>>}
 */
export async function getHighImpactNews() {
  const allEvents = await fetchLiveRealtimeNews();

  if (!Array.isArray(allEvents) || allEvents.length === 0) {
    log.info('Tidak ada event berita USD real-time yang didapatkan saat ini.');
    return [];
  }

  // Filter semua berita USD
  const usdEvents = allEvents.filter(e => (e.currency || '').toUpperCase() === 'USD');

  log.info(`Ditemukan ${usdEvents.length} berita USD real-time dari Forex Factory`);
  return usdEvents;
}

/**
 * Invalidate cache.
 */
export function clearCache() {
  cache = { data: null, timestamp: 0 };
  log.info('Cache di-clear');
}
