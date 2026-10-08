import fs from 'fs';
import path from 'path';
import axios from 'axios';
import xml2js from 'xml2js';
import config from '../utils/config.js';
import { createLogger } from '../utils/logger.js';
import { parseEconomicValue, formatWIBTime } from './parser.js';
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

function getHeaders() {
  const userAgent = config.USER_AGENTS[Math.floor(Math.random() * config.USER_AGENTS.length)] ||
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

  return {
    'User-Agent': userAgent,
    'Accept': 'application/xml, application/json, text/xml, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
  };
}

/**
 * Parse string tanggal MM-DD-YYYY dan waktu ET h:mmam/pm dari Forex Factory RSS XML
 * menjadi Date object dalam zona waktu Eastern (EDT -04:00 / EST -05:00).
 */
function parseFFXmlDate(dateStr, timeStr) {
  if (!dateStr) return new Date();

  const parts = String(dateStr).trim().split('-');
  if (parts.length !== 3) return new Date();

  const month = parts[0];
  const day = parts[1];
  const year = parts[2];

  let hours = 12;
  let minutes = 0;

  if (timeStr && /^\d{1,2}:\d{2}(am|pm)$/i.test(String(timeStr).trim())) {
    const match = String(timeStr).trim().match(/^(\d{1,2}):(\d{2})(am|pm)$/i);
    let h = parseInt(match[1]);
    const m = parseInt(match[2]);
    const ampm = match[3].toLowerCase();

    if (ampm === 'pm' && h !== 12) h += 12;
    if (ampm === 'am' && h === 12) h = 0;
    hours = h;
    minutes = m;
  }

  const isoStr = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:00-04:00`;
  const dateObj = new Date(isoStr);
  return isNaN(dateObj.getTime()) ? new Date() : dateObj;
}

/**
 * Parse XML feed dari Forex Factory (FairEconomy RSS Feed).
 */
async function parseXmlEvents(xmlString) {
  try {
    const parsed = await xml2js.parseStringPromise(xmlString);
    const rawEvents = parsed?.weeklyevents?.event || [];

    return rawEvents
      .filter(item => {
        const country = item?.country?.[0] || '';
        return country === 'USD';
      })
      .map(item => {
        const title = item?.title?.[0] || 'Economic News';
        const dateStr = item?.date?.[0] || '';
        const timeStr = item?.time?.[0] || '';
        const impactStr = (item?.impact?.[0] || 'medium').toLowerCase();
        const forecastRaw = item?.forecast?.[0] || '-';
        const previousRaw = item?.previous?.[0] || '-';
        const actualRaw = item?.actual?.[0] || '-';

        const dateObj = parseFFXmlDate(dateStr, timeStr);
        const wibInfo = formatWIBTime(dateObj);

        return {
          id: `ff_xml_${dateStr}_${title}`,
          source: 'Forex Factory',
          date: wibInfo.dateStr,
          time: timeStr || wibInfo.timeWIBStr,
          timeWIB: wibInfo.displayWIB,
          timestamp: wibInfo.timestamp,
          currency: 'USD',
          impact: impactStr.includes('high') ? 'high' : impactStr.includes('medium') ? 'medium' : 'low',
          event: title,
          actual: actualRaw !== '' ? actualRaw : '-',
          forecast: forecastRaw !== '' ? forecastRaw : '-',
          previous: previousRaw !== '' ? previousRaw : '-',
          actualValue: parseEconomicValue(actualRaw),
          forecastValue: parseEconomicValue(forecastRaw),
          previousValue: parseEconomicValue(previousRaw),
        };
      });
  } catch (err) {
    log.warn(`Gagal parse XML Forex Factory: ${err.message}`);
    return [];
  }
}

/**
 * Fallback parser untuk JSON feed Forex Factory.
 */
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
        id: `ff_json_${item.date || ''}_${item.title || item.event}`,
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
 * Fetch data berita kalender Forex Factory secara LIVE REALTIME via RSS XML Feed & JSON Fallback.
 */
export async function fetchLiveRealtimeNews() {
  const now = Date.now();

  // Cache 30 detik untuk kelancaran realtime tanpa delay rilis
  if (cache.data && cache.data.length > 0 && (now - cache.timestamp) < (30 * 1000)) {
    return cache.data;
  }

  log.info('🌐 Fetching Forex Factory RSS XML Feed (FairEconomy API)...');
  const primaryXmlUrl = 'https://nfs.faireconomy.media/ff_calendar_thisweek.xml';
  const xmlEndpoints = [
    primaryXmlUrl,
    'https://api.allorigins.win/raw?url=' + encodeURIComponent(primaryXmlUrl),
    'https://corsproxy.io/?url=' + encodeURIComponent(primaryXmlUrl),
  ];

  let errors = [];

  // 1. STRATEGI 1: RSS XML Feed (Utama)
  for (const endpointUrl of xmlEndpoints) {
    try {
      const res = await axios.get(endpointUrl, {
        headers: getHeaders(),
        timeout: 10000,
        responseType: 'text',
      });

      if (res.status === 200 && res.data) {
        const parsed = await parseXmlEvents(res.data);
        if (parsed.length > 0) {
          log.info(`✅ Forex Factory RSS XML API Berhasil! (${parsed.length} USD events)`);
          logScrapeResult('ForexFactoryRSS', true, parsed.length);
          cache.data = parsed;
          cache.timestamp = now;
          saveDiskCache(parsed);
          return parsed;
        }
      }
    } catch (err) {
      errors.push(err.message);
      log.warn(`ForexFactory RSS XML endpoint error (${endpointUrl}): ${err.message}`);
    }
  }

  // 2. STRATEGI 2: Fallback ke JSON Feed jika XML terhalang
  try {
    const jsonUrl = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
    const jsonRes = await axios.get(jsonUrl, { headers: getHeaders(), timeout: 10000 });
    if (jsonRes.status === 200 && jsonRes.data) {
      const parsedJson = parseJsonEvents(jsonRes.data);
      if (parsedJson.length > 0) {
        log.info(`✅ Forex Factory JSON Fallback Berhasil! (${parsedJson.length} USD events)`);
        logScrapeResult('ForexFactoryJSON', true, parsedJson.length);
        cache.data = parsedJson;
        cache.timestamp = now;
        saveDiskCache(parsedJson);
        return parsedJson;
      }
    }
  } catch (jsonErr) {
    errors.push(jsonErr.message);
  }

  logScrapeResult('ForexFactory', false, 0, errors.join(' | '));

  // Fallback ke disk cache jika ada
  if (cache.data && cache.data.length > 0) {
    log.warn('⚠️ Menggunakan data disk cache kalender karena koneksi live gagal.');
    return cache.data;
  }

  return [];
}

import { scrapeLiveCalendarWithPuppeteer } from './puppeteerScraper.js';
import { fetchRapidApiCalendar } from './rapidApiCalendar.js';

export async function getHighImpactNews() {
  // 1. Sumber utama: RapidAPI Forex Factory Scraper (realtime, termasuk 'actual')
  let allEvents = await fetchRapidApiCalendar().catch(err => {
    log.warn(`RapidAPI error: ${err.message}`);
    return null;
  });

  // 2. Fallback: scrape HTML asli dengan Puppeteer
  if (!allEvents || allEvents.length === 0) {
    allEvents = await scrapeLiveCalendarWithPuppeteer();
  }

  // 3. Fallback terakhir: API XML gratis FairEconomy
  if (!allEvents || allEvents.length === 0) {
    allEvents = await fetchLiveRealtimeNews();
  }

  if (!Array.isArray(allEvents)) return [];
  return allEvents.filter(e => (e.currency || '').toUpperCase() === 'USD');
}

export function clearCache() {
  cache = { data: null, timestamp: 0 };
}
