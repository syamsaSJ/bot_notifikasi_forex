import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import config from '../utils/config.js';
import { createLogger } from '../utils/logger.js';
import {
  parseToDateObj,
  formatWIBTime,
  parseEconomicValue,
  normalizeCalendarTitleKey,
  parseCalendarHTML,
} from './parser.js';
import { analyzeSignal } from '../engine/signalEngine.js';
import { logScrapeResult } from '../utils/scrapeLogger.js';
import { saveUnifiedFeedToSupabase, isSupabaseConfigured } from '../services/supabaseService.js';

// Tambahkan stealth plugin untuk membypass Cloudflare & proteksi bot
puppeteer.use(StealthPlugin());

const log = createLogger('PuppeteerScraper');

let calendarCache = {
  data: null,
  timestamp: 0,
};

const CACHE_TTL_MS = 10 * 60 * 1000; // 10 menit cache lokal
let browserInstance = null;
let pageInstance = null;

/**
 * Mengambil IP asli domain via Cloudflare 1.1.1.1 (DNS over HTTPS)
 * Mem-bypass pemblokiran ISP Indonesia (TrustPositif / Nawala / Internet Positif).
 * 
 * @param {string} domain 
 * @returns {Promise<string>}
 */
export async function getRealIpAddress(domain = 'www.forexfactory.com') {
  try {
    const res = await fetch(`https://1.1.1.1/dns-query?name=${domain}&type=A`, {
      headers: { accept: 'application/dns-json' },
    });
    const data = await res.json();
    const ipRecord = data.Answer?.find((record) => record.type === 1);
    const ip = ipRecord ? ipRecord.data : '104.26.0.214';
    log.debug(`DNS 1.1.1.1 lookup untuk ${domain}: ${ip}`);
    return ip;
  } catch (err) {
    log.warn(`Gagal fetch DNS over HTTPS (1.1.1.1): ${err.message}, menggunakan IP fallback`);
    return '104.26.0.214';
  }
}

/**
 * Format item mentah dari window.calendarComponentStates ke format standar bot & Supabase.
 */
export function formatForexFactoryPuppeteerItem(item) {
  const title = (item.event || item.name || item.prefixedName || 'Economic Event').trim();
  
  let dateObj;
  if (item.dateline) {
    dateObj = new Date(item.dateline);
  } else if (item.dateFallback) {
    dateObj = parseToDateObj(item.dateFallback);
  } else {
    dateObj = new Date();
  }

  const wibInfo = formatWIBTime(dateObj);
  const currency = (item.currency || 'USD').toUpperCase();
  const rawImpact = (item.impact || 'low').toLowerCase();
  const impact = rawImpact.includes('high')
    ? 'high'
    : rawImpact.includes('medium')
    ? 'medium'
    : 'low';

  const cleanTitle = normalizeCalendarTitleKey(title) || title.toLowerCase().replace(/[^a-z0-9]/g, '');
  const eventId = `cal_${wibInfo.dateStr}_${currency}_${cleanTitle}`;

  const actualStr = item.actual !== undefined && item.actual !== null && String(item.actual).trim() !== '' ? String(item.actual).trim() : '-';
  const forecastStr = item.forecast !== undefined && item.forecast !== null && String(item.forecast).trim() !== '' ? String(item.forecast).trim() : '-';
  const previousStr = item.previous !== undefined && item.previous !== null && String(item.previous).trim() !== '' ? String(item.previous).trim() : '-';

  const evtObj = {
    id: String(eventId),
    itemType: 'calendar',
    source: 'Forex Factory',
    event: title,
    title: title,
    date: wibInfo.dateStr,
    time: wibInfo.timeWIBStr,
    timeWIB: wibInfo.displayWIB,
    timestamp: wibInfo.timestamp,
    currency: currency,
    impact: impact,
    actual: actualStr,
    forecast: forecastStr,
    previous: previousStr,
    actualValue: parseEconomicValue(actualStr),
    forecastValue: parseEconomicValue(forecastStr),
    previousValue: parseEconomicValue(previousStr),
    url: 'https://www.forexfactory.com/calendar',
  };

  const signal = analyzeSignal(evtObj);
  evtObj.signal = signal;
  evtObj.analysis = {
    signal: signal.signal,
    direction: signal.direction,
    impactText: signal.predictionText,
  };

  return evtObj;
}

/**
 * Deduplikasi dan penggabungan item kalender dengan memprioritaskan nilai actual yang terisi.
 */
function deduplicateCalendarItems(items) {
  const mergedMap = new Map();
  items.forEach(item => {
    const titleKey = normalizeCalendarTitleKey(item.event || item.title);
    const key = `${item.date}_${item.currency || 'USD'}_${titleKey}`;

    if (!mergedMap.has(key)) {
      mergedMap.set(key, item);
    } else {
      const existing = mergedMap.get(key);
      if (item.actual && item.actual !== '-' && (!existing.actual || existing.actual === '-')) {
        existing.actual = item.actual;
        existing.actualValue = item.actualValue;
        existing.signal = item.signal;
        existing.analysis = item.analysis;
      }
      if (item.forecast && item.forecast !== '-' && (!existing.forecast || existing.forecast === '-')) {
        existing.forecast = item.forecast;
        existing.forecastValue = item.forecastValue;
      }
      if (item.previous && item.previous !== '-' && (!existing.previous || existing.previous === '-')) {
        existing.previous = item.previous;
        existing.previousValue = item.previousValue;
      }
    }
  });

  return Array.from(mergedMap.values());
}

/**
 * Mengambil data event dari halaman kalender Forex Factory via window.calendarComponentStates
 * Dioptimalkan dengan Resource Interception (blokir image, css, font) agar super cepat (1-3 detik) & anti-timeout di Render.
 */
async function scrapeCalendarPage(page, url) {
  log.info(`[Puppeteer] Membuka URL: ${url}`);
  
  // Blokir aset berat & analytics yang tidak dibutuhkan (gambar, font, css, media, tracker) agar hemat memori & kilat
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const rt = req.resourceType();
    const reqUrl = req.url().toLowerCase();
    if (
      ['image', 'stylesheet', 'font', 'media'].includes(rt) ||
      reqUrl.includes('google-analytics') ||
      reqUrl.includes('googletagmanager') ||
      reqUrl.includes('doubleclick') ||
      reqUrl.includes('cloudflareinsights') ||
      reqUrl.includes('clarity.ms')
    ) {
      req.abort();
    } else {
      req.continue();
    }
  });

  await page.goto(url, {
    waitUntil: 'domcontentloaded',
    timeout: 25000,
  });

  // Tunggu sampai state kalender Forex Factory terpasang di window
  await page.waitForFunction(
    () => !document.title.includes('Just a moment') && window.calendarComponentStates,
    { timeout: 20000 }
  );

  const rawEvents = await page.evaluate(() => {
    const results = [];
    const states = window.calendarComponentStates;
    if (states) {
      const stateKey = Object.keys(states)[0];
      const days = states[stateKey]?.days || [];
      days.forEach((day) => {
        (day.events || []).forEach((ev) => {
          if (ev.currency === 'USD') {
            results.push({
              dateline: ev.dateline ? ev.dateline * 1000 : null,
              dateFallback: day.date || '',
              timeLabel: ev.timeLabel || '',
              currency: ev.currency,
              impact: ev.impactTitle ? ev.impactTitle.replace(' Impact Expected', '') : ev.impactName || 'Low',
              event: ev.name || ev.prefixedName || '',
              actual: ev.actual || '-',
              forecast: ev.forecast || '-',
              previous: ev.previous || '-',
            });
          }
        });
      });
    }
    return results;
  });

  return rawEvents;
}

let activeScrapePromise = null;

/**
 * Ambil data kalender ekonomi Minggu Ini & Minggu Depan menggunakan Puppeteer Stealth & Bypass DoH 1.1.1.1
 * Dioptimalkan untuk Render Free Tier (RAM 512MB & CPU 0.1): Parallel Tabs + Resource Blocking (1-5 detik).
 * 
 * @param {Object} options
 * @param {string} options.scope - 'two_weeks' (Minggu Ini & Next Week), 'this_week', 'next_week', atau 'today'
 * @param {boolean} options.force - Lewati cache jika true
 * @returns {Promise<Array>} Array event kalender terstandarisasi
 */
export async function fetchForexFactoryCalendarPuppeteer(options = {}) {
  const { scope = 'two_weeks', force = false } = options;
  const now = Date.now();

  if (!force && calendarCache.data && calendarCache.data.length > 0 && (now - calendarCache.timestamp) < CACHE_TTL_MS) {
    log.info(`ℹ️ [Puppeteer] Menggunakan cache kalender (${calendarCache.data.length} events, sisa TTL: ${Math.round((CACHE_TTL_MS - (now - calendarCache.timestamp)) / 1000)}s).`);
    return calendarCache.data;
  }

  // Concurrency Guard: Jika sedang scraping, tunggu promise yang sedang aktif (cegah browser ganda)
  if (activeScrapePromise) {
    log.info(`⏳ [Puppeteer] Scraping kalender sedang berjalan di thread lain. Menunggu hasil selesai...`);
    return await activeScrapePromise;
  }

  activeScrapePromise = (async () => {
    log.info(`🚀 [Puppeteer Turbo] Memulai scraping cepat Forex Factory (Scope: ${scope}, Parallel + Asset Blocking)...`);
    const startTime = Date.now();

    const realIp = await getRealIpAddress('www.forexfactory.com');
    log.info(`🌐 [Puppeteer] IP asli terdeteksi: ${realIp}`);

    const launchArgs = [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-software-rasterizer',
      '--disable-extensions',
      '--mute-audio',
      '--disable-accelerated-2d-canvas',
      '--js-flags=--max-old-space-size=256',
      '--disable-blink-features=AutomationControlled',
      '--window-size=960,600',
      `--host-resolver-rules=MAP www.forexfactory.com ${realIp}, MAP forexfactory.com ${realIp}`,
    ];

    let browser;
    try {
      browser = await puppeteer.launch({
        headless: 'new',
        ignoreDefaultArgs: ['--enable-automation'],
        args: launchArgs,
      });
    } catch (launchErr) {
      log.error(`Gagal meluncurkan Puppeteer: ${launchErr.message}`);
      throw launchErr;
    }

    const allRawEvents = [];

    try {
      // Jika butuh 2 minggu (This Week & Next Week), buka secara PARALEL di 2 tab terpisah agar kilat (3-5 detik)
      if (scope === 'two_weeks' || scope === 'weekly') {
        log.info('📅 [Puppeteer Turbo] Mengambil Minggu Ini & Minggu Depan secara PARALEL...');
        const [pageThis, pageNext] = await Promise.all([browser.newPage(), browser.newPage()]);

        const [thisWeekEvents, nextWeekEvents] = await Promise.all([
          scrapeCalendarPage(pageThis, 'https://www.forexfactory.com/calendar?week=this').catch(err => {
            log.warn(`Gagal scrape this week: ${err.message}`);
            return [];
          }),
          scrapeCalendarPage(pageNext, 'https://www.forexfactory.com/calendar?week=next').catch(err => {
            log.warn(`Gagal scrape next week: ${err.message}`);
            return [];
          }),
        ]);

        allRawEvents.push(...thisWeekEvents, ...nextWeekEvents);
        log.info(`✅ [Puppeteer Turbo] Berhasil mengambil total ${allRawEvents.length} event USD (Paralel selesai dalam ${Date.now() - startTime}ms).`);
      } else {
        const page = await browser.newPage();
        const targetUrl = (scope === 'next_week')
          ? 'https://www.forexfactory.com/calendar?week=next'
          : 'https://www.forexfactory.com/calendar?week=this';

        const events = await scrapeCalendarPage(page, targetUrl);
        allRawEvents.push(...events);
      }

      // Format item ke format standar bot
      const formattedEvents = allRawEvents.map(formatForexFactoryPuppeteerItem);

      // Filter jika hanya minta 'today'
      let filteredEvents = formattedEvents;
      if (scope === 'today') {
        const todayStr = new Date().toLocaleDateString('sv-SE', { timeZone: config.TIMEZONE || 'Asia/Jakarta' });
        filteredEvents = formattedEvents.filter(e => e.date === todayStr);
      }

      // Deduplikasi
      const finalEvents = deduplicateCalendarItems(filteredEvents);

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      log.info(`🎉 [Puppeteer] Sukses mengambil total ${finalEvents.length} event USD (Scope: ${scope}) dalam ${duration} detik ($0 Cost).`);
      logScrapeResult('ForexFactoryPuppeteer', true, finalEvents.length);

      // Simpan otomatis ke Supabase Database jika aktif
      if (isSupabaseConfigured() && finalEvents.length > 0) {
        await saveUnifiedFeedToSupabase(finalEvents).catch(e => {
          log.warn(`Gagal menyimpan kalender Puppeteer ke Supabase: ${e.message}`);
        });
      }

      calendarCache = {
        data: finalEvents,
        timestamp: Date.now(),
      };

      return finalEvents;
    } catch (error) {
      log.error('❌ [Puppeteer] Gagal mengambil data Forex Factory:', error.message);
      logScrapeResult('ForexFactoryPuppeteer', false, 0, error.message);
      return calendarCache.data || [];
    } finally {
      if (browser) {
        await browser.close().catch(() => {});
      }
    }
  })();

  try {
    return await activeScrapePromise;
  } finally {
    activeScrapePromise = null;
  }
}

/**
 * Inisialisasi browser instance (backward compatibility)
 */
export async function initBrowser() {
  if (browserInstance) return browserInstance;
  log.info('🚀 Inisialisasi Puppeteer Stealth Browser...');
  try {
    const realIp = await getRealIpAddress('www.forexfactory.com');
    browserInstance = await puppeteer.launch({
      headless: 'new',
      ignoreDefaultArgs: ['--enable-automation'],
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--window-size=1280,800',
        `--host-resolver-rules=MAP www.forexfactory.com ${realIp}, MAP forexfactory.com ${realIp}`,
      ],
    });
    pageInstance = await browserInstance.newPage();
    return browserInstance;
  } catch (err) {
    log.warn('Puppeteer browser init info:', err.message);
    return null;
  }
}

/**
 * Tutup browser jika aplikasi dimatikan (backward compatibility)
 */
export async function closeBrowser() {
  if (browserInstance) {
    await browserInstance.close().catch(() => {});
    browserInstance = null;
    pageInstance = null;
    log.info('Browser Puppeteer ditutup.');
  }
}

/**
 * Scrape langsung kalender Forex Factory (backward compatibility)
 */
export async function scrapeLiveCalendarWithPuppeteer() {
  return await fetchForexFactoryCalendarPuppeteer({ scope: 'this_week', force: true });
}

export function clearPuppeteerCache() {
  calendarCache = { data: null, timestamp: 0 };
}
