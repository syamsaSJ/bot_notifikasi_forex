import fs from 'fs';
import path from 'path';
import axios from 'axios';
import xml2js from 'xml2js';
import config from '../utils/config.js';
import { createLogger } from '../utils/logger.js';
import { parseEconomicValue, formatWIBTime, normalizeCalendarTitleKey } from './parser.js';

import { logScrapeResult } from '../utils/scrapeLogger.js';

const log = createLogger('ForexFactoryScraper');

let cache = {
  data: null,
  timestamp: 0,
};

function getHeaders() {
  const userAgent = config.USER_AGENTS[Math.floor(Math.random() * config.USER_AGENTS.length)] ||
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

  return {
    'User-Agent': userAgent,
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://www.forexfactory.com/',
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
      .filter(item => item && item.title?.[0])
      .map((item, idx) => {
        const title = item?.title?.[0] || 'Economic News';
        const dateStr = item?.date?.[0] || '';
        const timeStr = item?.time?.[0] || '';
        const country = (item?.country?.[0] || 'USD').toUpperCase();
        const impactStr = (item?.impact?.[0] || 'medium').toLowerCase();
        const forecastRaw = item?.forecast?.[0] || '-';
        const previousRaw = item?.previous?.[0] || '-';
        const actualRaw = item?.actual?.[0] || '-';

        const dateObj = parseFFXmlDate(dateStr, timeStr);
        const wibInfo = formatWIBTime(dateObj);
        const cleanTitle = title.toLowerCase().replace(/[^a-z0-9]/g, '');

        const hasClock = timeStr && /^\d{1,2}:\d{2}(am|pm)$/i.test(String(timeStr).trim());
        const finalTime = hasClock ? convertETtoWIB(timeStr, dateStr) : '-';
        const finalTimeWIB = hasClock ? wibInfo.displayWIB : `${wibInfo.displayWIB.split('•')[0].trim()} • -`;

        return {
          id: `ff_xml_${wibInfo.dateStr}_${country}_${cleanTitle}_${idx}`,
          source: 'Forex Factory',
          date: wibInfo.dateStr,
          time: finalTime,
          timeWIB: finalTimeWIB,
          timestamp: wibInfo.timestamp,
          currency: country,
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
 * Fallback parser untuk JSON feed Forex Factory (ff_calendar_thisweek.json).
 */
function parseJsonEvents(jsonInput) {
  let jsonArray = jsonInput;
  if (typeof jsonInput === 'string') {
    try { jsonArray = JSON.parse(jsonInput); } catch (e) { return []; }
  }
  if (!Array.isArray(jsonArray)) return [];

  return jsonArray
    .filter(item => item && (item.title || item.event))
    .map((item, idx) => {
      const dateObj = new Date(item.date || Date.now());
      const wibInfo = formatWIBTime(dateObj);
      const impactStr = (item.impact || 'medium').toLowerCase();
      const currency = (item.country || item.currency || 'USD').toUpperCase();
      const eventName = item.title || item.event || 'Economic News';
      const cleanTitle = eventName.toLowerCase().replace(/[^a-z0-9]/g, '');

      const timeRaw = item.time || '';
      const hasClock = timeRaw && /^\d{1,2}:\d{2}(am|pm)$/i.test(String(timeRaw).trim());
      const finalTime = hasClock ? convertETtoWIB(timeRaw, item.date) : '-';
      const finalTimeWIB = hasClock ? wibInfo.displayWIB : `${wibInfo.displayWIB.split('•')[0].trim()} • -`;

      return {
        id: `ff_json_${wibInfo.dateStr}_${currency}_${cleanTitle}_${idx}`,
        source: 'Forex Factory',
        date: wibInfo.dateStr,
        time: finalTime,
        timeWIB: finalTimeWIB,
        timestamp: wibInfo.timestamp,
        currency: currency,
        impact: impactStr.includes('high') ? 'high' : impactStr.includes('medium') ? 'medium' : 'low',
        event: eventName,
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
 * Fetch data berita kalender Forex Factory secara LIVE REALTIME via FairEconomy JSON Feed (ff_calendar_thisweek.json) & XML Fallback.
 */
export async function fetchLiveRealtimeNews() {
  const now = Date.now();

  // Cache 1 menit untuk mendukung polling realtime 1-menit tanpa 429 Rate Limit
  if (cache.data && cache.data.length > 0 && (now - cache.timestamp) < (60 * 1000)) {
    return cache.data;
  }

  log.info('🌐 Fetching Forex Factory Weekly Calendar (https://nfs.faireconomy.media/ff_calendar_thisweek.json)...');
  
  const jsonUrl = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
  const xmlUrl  = 'https://nfs.faireconomy.media/ff_calendar_thisweek.xml';

  let errors = [];

  // 1. STRATEGI UTAMA: FairEconomy JSON Feed (ff_calendar_thisweek.json)
  try {
    const jsonRes = await axios.get(jsonUrl, { headers: getHeaders(), timeout: 10000 });
    if (jsonRes.status === 200 && jsonRes.data) {
      const parsedJson = parseJsonEvents(jsonRes.data);
      if (parsedJson.length > 0) {
        log.info(`✅ Forex Factory JSON Weekly Feed Berhasil! (${parsedJson.length} total events)`);
        logScrapeResult('ForexFactoryJSON', true, parsedJson.length);
        cache.data = parsedJson;
        cache.timestamp = now;
        return parsedJson;
      }
    }
  } catch (jsonErr) {
    errors.push(`JSON error: ${jsonErr.message}`);
    log.warn(`ForexFactory JSON endpoint error: ${jsonErr.message}`);
  }

  // 2. STRATEGI FALLBACK: FairEconomy XML Feed (ff_calendar_thisweek.xml)
  try {
    const xmlRes = await axios.get(xmlUrl, { headers: getHeaders(), timeout: 10000, responseType: 'text' });
    if (xmlRes.status === 200 && xmlRes.data) {
      const parsedXml = await parseXmlEvents(xmlRes.data);
      if (parsedXml.length > 0) {
        log.info(`✅ Forex Factory XML Weekly Feed Berhasil! (${parsedXml.length} total events)`);
        logScrapeResult('ForexFactoryXML', true, parsedXml.length);
        cache.data = parsedXml;
        cache.timestamp = now;
        return parsedXml;
      }
    }
  } catch (xmlErr) {
    errors.push(`XML error: ${xmlErr.message}`);
  }

  logScrapeResult('ForexFactory', false, 0, errors.join(' | '));
  return cache.data || [];
}

import { scrapeLiveCalendarWithPuppeteer } from './puppeteerScraper.js';
import { fetchRapidApiWeeklyCalendar, fetchRapidApiCalendar, isRapidApiConfigured } from './rapidApiCalendar.js';
import { fetchApifyCalendar, isApifyConfigured, clearApifyCache } from './apifyCalendar.js';

export async function getHighImpactNews(forceRefresh = false, range = 'realtime') {
  // 1. FREE SCHEDULE SOURCE ($0 COST): Ambil jadwal mingguan lengkap dari FairEconomy JSON Feed (ff_calendar_thisweek.json)
  let rawWeekly = await fetchLiveRealtimeNews().catch(err => {
    log.warn(`Fetch live weekly schedule error: ${err.message}`);
    return [];
  });

  let weeklyEvents = (rawWeekly || []).filter(e => {
    const curr = (e.currency || 'USD').toUpperCase();
    return curr === 'USD' || curr === 'ALL';
  });

  // 2. APIFY ACTUAL UPDATER (Silentflow Forex Factory Scraper)
  if (isApifyConfigured()) {
    const apifyEvents = await fetchApifyCalendar({ forceRefresh, range }).catch(err => {
      log.warn(`Apify calendar error: ${err.message}`);
      return [];
    });

    if (Array.isArray(apifyEvents) && apifyEvents.length > 0) {
      const filteredApify = apifyEvents.filter(ae => {
        const curr = (ae.currency || 'USD').toUpperCase();
        return curr === 'USD' || curr === 'ALL';
      });

      if (weeklyEvents.length > 0) {
        const apifyMap = new Map();
        filteredApify.forEach(ae => {
          const cleanTitle = normalizeCalendarTitleKey(ae.event || ae.title);
          apifyMap.set(cleanTitle, ae);
        });

        // Update nilai actual & forecast jika data rilis Apify tersedia
        weeklyEvents.forEach(we => {
          const cleanTitle = normalizeCalendarTitleKey(we.event || we.title);
          if (apifyMap.has(cleanTitle)) {
            const ae = apifyMap.get(cleanTitle);
            if (ae.actual && ae.actual !== '-') {
              we.actual = ae.actual;
              we.actualValue = ae.actualValue;
            }
            if (ae.forecast && ae.forecast !== '-') {
              we.forecast = ae.forecast;
              we.forecastValue = ae.forecastValue;
            }
            if (ae.previous && ae.previous !== '-') {
              we.previous = ae.previous;
              we.previousValue = ae.previousValue;
            }
          }
        });

        // Tambahkan event Apify baru yang belum ada di jadwal minggu ini
        const existingCleanTitles = new Set(weeklyEvents.map(we => normalizeCalendarTitleKey(we.event || we.title)));
        filteredApify.forEach(ae => {
          const cleanTitle = normalizeCalendarTitleKey(ae.event || ae.title);
          if (!existingCleanTitles.has(cleanTitle)) {
            weeklyEvents.push(ae);
          }
        });
      } else {
        weeklyEvents = filteredApify;
      }
    }
  }

  // Deduplikasi internal secara ketat berdasarkan date, currency & normalizeCalendarTitleKey
  const seenKeys = new Map();
  (weeklyEvents || []).forEach((event) => {
    const clean = normalizeCalendarTitleKey(event.event || event.title);
    const key = `${event.date}_${event.currency || 'USD'}_${clean}`;

    if (!seenKeys.has(key)) {
      seenKeys.set(key, event);
    } else {
      const existing = seenKeys.get(key);
      if (event.actual && event.actual !== '-' && (!existing.actual || existing.actual === '-')) {
        existing.actual = event.actual;
        existing.actualValue = event.actualValue;
      }
    }
  });

  return Array.from(seenKeys.values());
}

export function clearCache() {
  cache = { data: null, timestamp: 0 };
  clearApifyCache();
}

