import axios from 'axios';
import xml2js from 'xml2js';
import config from '../utils/config.js';
import { createLogger } from '../utils/logger.js';
import { formatWIBTime, parseToDateObj } from './parser.js';
import { logScrapeResult } from '../utils/scrapeLogger.js';
import { getHighImpactNews } from './forexFactory.js';
import { analyzeSignal, analyzeInvestingHeadline, isGoldRelevant } from '../engine/signalEngine.js';

const log = createLogger('UnifiedFeed');

let unifiedCache = {
  data: null,
  timestamp: 0,
};

const INVESTING_FEEDS = [
  { name: 'Forex & USD', url: 'https://www.investing.com/rss/news_1.rss' },
  { name: 'Komoditas & Emas', url: 'https://www.investing.com/rss/news_11.rss' },
  { name: 'Indikator Ekonomi', url: 'https://www.investing.com/rss/news_95.rss' },
  { name: 'Forex Analysis', url: 'https://www.investing.com/rss/forex.rss' },
  { name: 'Market Overview', url: 'https://www.investing.com/rss/market_overview.rss' },
];

const EXTRA_FEEDS = [
  { name: 'InvestingLive', url: 'https://investinglive.com/feed/' },
  { name: 'Google News Gold/Fed', url: 'https://news.google.com/rss/search?q=(gold+OR+XAUUSD+OR+%22US+dollar%22+OR+Fed)+when:1d&hl=en-US&gl=US&ceid=US:en' },
];

function getHeaders() {
  return {
    'User-Agent': config.USER_AGENTS[Math.floor(Math.random() * config.USER_AGENTS.length)],
    'Accept': 'application/xml, text/xml, application/json, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
  };
}

async function fetchNewsHeadlines() {
  const headlines = [];
  const allSources = [...INVESTING_FEEDS, ...EXTRA_FEEDS];

  for (const feed of allSources) {
    try {
      const res = await axios.get(feed.url, { headers: getHeaders(), timeout: 8000, responseType: 'text' });
      if (res.status === 200 && res.data) {
        const parsed = await xml2js.parseStringPromise(res.data);
        const items = parsed?.rss?.channel?.[0]?.item || [];

        items.forEach(item => {
          const title = item.title?.[0] || 'Market News';
          const category = feed.name;
          const sourceName = item.source?.[0] ? (typeof item.source[0] === 'object' ? item.source[0]._ : item.source[0]) : feed.name;

          const rawItem = { title, category, source: sourceName };

          // FILTER EKSKLUSIF: Hanya sertakan berita yang RELEVAN dengan pergerakan XAU/USD GOLD
          if (!isGoldRelevant(rawItem)) {
            return;
          }

          const rawDate = item.pubDate?.[0] || item['dc:date']?.[0] || '';
          const dateObj = parseToDateObj(rawDate);
          const wibInfo = formatWIBTime(dateObj);
          const link = item.link?.[0] || (typeof item.guid?.[0] === 'string' ? item.guid[0] : '#');

          const analysis = analyzeInvestingHeadline(title, feed.name);

          headlines.push({
            id: `news_${dateObj.getTime()}_${title.slice(0, 20)}`,
            itemType: 'investing',
            source: sourceName || 'Investing.com',
            title,
            link,
            pubDate: rawDate,
            date: wibInfo.dateStr,
            timeWIB: wibInfo.displayWIB,
            timestamp: wibInfo.timestamp,
            category: feed.name,
            analysis,
            signal: analysis,
            isGoldRelevant: true,
          });
        });

        logScrapeResult(`RSS:${feed.name}`, true, items.length);
      }
    } catch (err) {
      log.warn(`Gagal fetch RSS (${feed.name}): ${err.message}`);
      logScrapeResult(`RSS:${feed.name}`, false, 0, err.message);
    }
  }

  return headlines;
}

export async function getUnifiedFeed(forceRefresh = false) {
  const now = Date.now();

  if (!forceRefresh && unifiedCache.data && (now - unifiedCache.timestamp) < 30000) {
    return unifiedCache.data;
  }

  log.info('🌐 Mengambil & Memproses Unified Realtime News Feed (Filter XAU/USD Gold)...');

  try {
    const [calendarEvents, newsHeadlines] = await Promise.all([
      getHighImpactNews().catch(err => {
        log.error('Error in getHighImpactNews:', err.message);
        return [];
      }),
      fetchNewsHeadlines().catch(err => {
        log.error('Error in fetchNewsHeadlines:', err.message);
        return [];
      }),
    ]);

    // Format calendar events & filter hanya yang relevan XAU/USD Gold
    const formattedCalendarItems = calendarEvents
      .filter(evt => isGoldRelevant({ title: evt.event, event: evt.event }))
      .map(evt => {
        const signal = analyzeSignal(evt);
        return {
          id: `cal_${evt.date}_${evt.event}`,
          itemType: 'calendar',
          source: 'Forex Factory',
          event: evt.event,
          title: evt.event,
          date: evt.date,
          time: evt.time,
          timeWIB: evt.timeWIB,
          timestamp: evt.timestamp || Date.now(),
          currency: 'USD',
          impact: evt.impact,
          actual: evt.actual,
          forecast: evt.forecast,
          previous: evt.previous,
          signal,
          analysis: {
            signal: signal.signal,
            direction: signal.direction,
            impactText: signal.predictionText,
          },
          isGoldRelevant: true,
        };
      });

    // Combine all
    const allCombined = [...formattedCalendarItems, ...newsHeadlines];

    // Deduplikasi berdasarkan title/event
    const seenTitles = new Set();
    const deduplicated = [];

    allCombined.forEach(item => {
      const cleanTitle = (item.title || item.event || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const key = `${item.date}_${cleanTitle.slice(0, 35)}`;
      if (!seenTitles.has(key)) {
        seenTitles.add(key);
        deduplicated.push(item);
      }
    });

    // Urutkan berdasarkan timestamp terbaru di atas
    deduplicated.sort((a, b) => b.timestamp - a.timestamp);

    log.info(`✅ Unified Feed Filtered Gold Berhasil: Total ${deduplicated.length} items (Kalender: ${formattedCalendarItems.length}, News: ${newsHeadlines.length})`);

    unifiedCache.data = deduplicated;
    unifiedCache.timestamp = now;
    return deduplicated;
  } catch (err) {
    log.error('Gagal membuat Unified Feed:', err.message);
    logScrapeResult('UnifiedFeed', false, 0, err.message);
    return unifiedCache.data || [];
  }
}
