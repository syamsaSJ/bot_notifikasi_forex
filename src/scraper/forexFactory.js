import fs from 'fs';
import path from 'path';
import axios from 'axios';
import config from '../utils/config.js';
import { createLogger } from '../utils/logger.js';
import { parseCalendarHTML, parseEconomicValue, formatWIBTime } from './parser.js';
import { logScrapeResult } from '../utils/scrapeLogger.js';

const log = createLogger('ForexFactoryScraper');
const CACHE_FILE_PATH = path.resolve('scratch', 'calendar_cache.json');

let cache = {
  data: null,
  timestamp: 0,
};

// Load disk cache jika ada
try {
  if (fs.existsSync(CACHE_FILE_PATH)) {
    const fileContent = fs.readFileSync(CACHE_FILE_PATH, 'utf-8');
    const parsedFile = JSON.parse(fileContent);
    if (Array.isArray(parsedFile) && parsedFile.length > 0) {
      cache.data = parsedFile;
      cache.timestamp = Date.now();
      log.info(`💾 Memuat ${parsedFile.length} data kalender dari cache disk.`);
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

function parseJsonEvents(jsonInput) {
  let jsonArray = jsonInput;
  if (typeof jsonInput === 'string') {
    try { jsonArray = JSON.parse(jsonInput); } catch (e) { return []; }
  }
  if (!Array.isArray(jsonArray)) return [];

  return jsonArray
    .filter(item => item && (item.country === 'USD' || item.currency === 'USD'))
    .map(item => {
      const dateObj = new Date(item.date || Date.now());
      const wibInfo = formatWIBTime(dateObj);
      const impactStr = (item.impact || 'medium').toLowerCase();

      return {
        id: `ff_${item.date || ''}_${item.title || item.event}`,
        source: 'Forex Factory',
        date: wibInfo.dateStr,
        time: item.time || wibInfo.timeWIBStr,
        timeWIB: wibInfo.displayWIB,
        timestamp: wibInfo.timestamp,
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
 * Fetch Nasdaq Economic Calendar sebagai pengisi actual jika ada.
 */
async function fetchNasdaqCalendarActuals() {
  try {
    const todayStr = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/New_York' });
    const url = `https://api.nasdaq.com/api/calendar/economicevents?date=${todayStr}`;
    const res = await axios.get(url, { headers: getJsonHeaders(), timeout: 10000 });
    const rows = res.data?.data?.rows || [];
    const nasdaqMap = {};

    rows.filter(r => /United States/i.test(r.country || '')).forEach(r => {
      if (r.eventName) {
        nasdaqMap[r.eventName.toLowerCase().trim()] = {
          actual: r.actual && r.actual !== '&nbsp;' ? r.actual : '-',
          consensus: r.consensus && r.consensus !== ' ' ? r.consensus : '-',
          previous: r.previous && r.previous !== ' ' ? r.previous : '-',
        };
      }
    });

    logScrapeResult('NasdaqCalendar', true, rows.length);
    return nasdaqMap;
  } catch (err) {
    logScrapeResult('NasdaqCalendar', false, 0, err.message);
    return {};
  }
}

/**
 * Fetch data berita kalender Forex Factory secara live.
 */
export async function fetchLiveRealtimeNews() {
  const now = Date.now();

  // Cache 5 menit untuk responsivitas realtime
  if (cache.data && cache.data.length > 0 && (now - cache.timestamp) < (5 * 60 * 1000)) {
    return cache.data;
  }

  log.info('🌐 Fetching Forex Factory USD economic events...');
  const targetUrl = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
  const jsonEndpoints = [
    targetUrl,
    'https://api.allorigins.win/raw?url=' + encodeURIComponent(targetUrl),
    'https://corsproxy.io/?url=' + encodeURIComponent(targetUrl),
  ];

  let errors = [];

  for (const endpointUrl of jsonEndpoints) {
    try {
      const res = await axios.get(endpointUrl, {
        headers: getJsonHeaders(),
        timeout: 10000,
      });

      if (res.status === 200 && res.data) {
        const parsed = parseJsonEvents(res.data);
        if (parsed.length > 0) {
          // Coba lengkapi data actual dari Nasdaq jika Forex Factory masukan '-'
          const nasdaqData = await fetchNasdaqCalendarActuals();
          parsed.forEach(e => {
            if (e.actual === '-') {
              const lowerEvt = e.event.toLowerCase().trim();
              for (const [nName, nObj] of Object.entries(nasdaqData)) {
                if (nName.includes(lowerEvt) || lowerEvt.includes(nName)) {
                  if (nObj.actual !== '-') {
                    e.actual = nObj.actual;
                    e.actualValue = parseEconomicValue(nObj.actual);
                  }
                  break;
                }
              }
            }
          });

          log.info(`✅ Forex Factory JSON Berhasil! (${parsed.length} USD events)`);
          logScrapeResult('ForexFactory', true, parsed.length);
          cache.data = parsed;
          cache.timestamp = now;
          saveDiskCache(parsed);
          return parsed;
        }
      }
    } catch (err) {
      errors.push(err.message);
      log.warn(`ForexFactory endpoint error (${endpointUrl}): ${err.message}`);
    }
  }

  logScrapeResult('ForexFactory', false, 0, errors.join(' | '));

  // Fallback ke stale cache jika ada
  if (cache.data && cache.data.length > 0) {
    log.warn('⚠️ Menggunakan data stale cache kalender karena koneksi live gagal.');
    return cache.data;
  }

  return [];
}

export async function getHighImpactNews() {
  const allEvents = await fetchLiveRealtimeNews();
  if (!Array.isArray(allEvents)) return [];
  return allEvents.filter(e => (e.currency || '').toUpperCase() === 'USD');
}

export function clearCache() {
  cache = { data: null, timestamp: 0 };
}
