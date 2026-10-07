import axios from 'axios';
import xml2js from 'xml2js';
import config from '../utils/config.js';
import { createLogger } from '../utils/logger.js';
import { formatWIBTime, parseToDateObj } from './parser.js';
import { logScrapeResult } from '../utils/scrapeLogger.js';
import { getHighImpactNews } from './forexFactory.js';
import { analyzeSignal, analyzeInvestingHeadline, analyzeHeadlineAsync } from '../engine/signalEngine.js';
import { isRelevantToXAUUSD } from '../utils/newsFilter.js';

const log = createLogger('UnifiedFeed');

let unifiedCache = {
  data: null,
  timestamp: 0,
};

function getHeaders() {
  return {
    'User-Agent': config.USER_AGENTS[Math.floor(Math.random() * config.USER_AGENTS.length)],
    'Accept': 'application/json, application/xml, text/xml, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
  };
}

/**
 * Fetch headline berita dari ForexLive.com RSS feed.
 */
async function fetchForexLiveRss() {
  const urls = [
    'https://www.forexlive.com/feed',
    'https://www.forexlive.com/feed/news',
    'https://investinglive.com/feed/',
  ];

  for (const url of urls) {
    try {
      const res = await axios.get(url, { headers: getHeaders(), timeout: 8000, responseType: 'text' });
      if (res.status === 200 && res.data) {
        const parsed = await xml2js.parseStringPromise(res.data);
        const items = parsed?.rss?.channel?.[0]?.item || [];

        if (items.length > 0) {
          logScrapeResult('ForexLive', true, items.length);

          return items
            .map(item => {
              const title = item.title?.[0] || 'ForexLive News';
              const rawDate = item.pubDate?.[0] || item['dc:date']?.[0] || '';
              const dateObj = parseToDateObj(rawDate);
              const wibInfo = formatWIBTime(dateObj);
              const link = item.link?.[0] || 'https://www.forexlive.com';
              const analysis = analyzeInvestingHeadline(title, 'ForexLive');

              return {
                id: `forexlive_${dateObj.getTime()}_${title.slice(0, 15)}`,
                itemType: 'investing',
                source: 'ForexLive',
                title,
                link,
                pubDate: rawDate,
                date: wibInfo.dateStr,
                timeWIB: wibInfo.displayWIB,
                timestamp: wibInfo.timestamp,
                category: 'ForexLive',
                analysis,
                signal: analysis,
              };
            })
            .filter(item => isRelevantToXAUUSD(item.title));
        }
      }
    } catch (err) {
      log.warn(`Gagal fetch ForexLive (${url}): ${err.message}`);
    }
  }

  logScrapeResult('ForexLive', false, 0, 'Connection Error');
  return [];
}

/**
 * Fetch headline berita dari NewsData.io API.
 */
async function fetchNewsDataIo() {
  if (!config.NEWSDATA_API_KEY || config.NEWSDATA_API_KEY.includes('your_')) {
    return [];
  }

  try {
    const url = `https://newsdata.io/api/1/news?apikey=${config.NEWSDATA_API_KEY}&q=gold%20OR%20xauusd%20OR%20fed&language=en`;
    const res = await axios.get(url, { headers: getHeaders(), timeout: 8000 });
    const results = res.data?.results || [];

    logScrapeResult('NewsData.io', true, results.length);

    return results
      .map(item => {
        const rawDate = item.pubDate || item.pubDateTZ || '';
        const dateObj = parseToDateObj(rawDate);
        const wibInfo = formatWIBTime(dateObj);
        const title = item.title || 'Market News';
        const analysis = analyzeInvestingHeadline(title, 'NewsData.io');

        return {
          id: `newsdata_${item.article_id || dateObj.getTime()}`,
          itemType: 'investing',
          source: item.source_id ? `NewsData (${item.source_id})` : 'NewsData.io',
          title,
          link: item.link || '#',
          pubDate: rawDate,
          date: wibInfo.dateStr,
          timeWIB: wibInfo.displayWIB,
          timestamp: wibInfo.timestamp,
          category: 'Market News',
          analysis,
          signal: analysis,
        };
      })
      .filter(item => isRelevantToXAUUSD(item.title));
  } catch (err) {
    log.warn(`Gagal fetch NewsData.io API: ${err.message}`);
    logScrapeResult('NewsData.io', false, 0, err.message);
    return [];
  }
}

/**
 * Fetch headline berita dari GNews API.
 */
async function fetchGNewsApi() {
  if (!config.GNEWS_API_KEY || config.GNEWS_API_KEY.includes('your_')) {
    return [];
  }

  try {
    const url = `https://gnews.io/api/v4/search?q=gold%20OR%20xauusd%20OR%20fed&lang=en&apikey=${config.GNEWS_API_KEY}`;
    const res = await axios.get(url, { headers: getHeaders(), timeout: 8000 });
    const articles = res.data?.articles || [];

    logScrapeResult('GNewsAPI', true, articles.length);

    return articles
      .map(item => {
        const rawDate = item.publishedAt || '';
        const dateObj = parseToDateObj(rawDate);
        const wibInfo = formatWIBTime(dateObj);
        const title = item.title || 'Market News';
        const analysis = analyzeInvestingHeadline(title, 'GNews');

        return {
          id: `gnews_${dateObj.getTime()}_${title.slice(0, 15)}`,
          itemType: 'investing',
          source: item.source?.name ? `GNews (${item.source.name})` : 'GNews API',
          title,
          link: item.url || '#',
          pubDate: rawDate,
          date: wibInfo.dateStr,
          timeWIB: wibInfo.displayWIB,
          timestamp: wibInfo.timestamp,
          category: 'GNews',
          analysis,
          signal: analysis,
        };
      })
      .filter(item => isRelevantToXAUUSD(item.title));
  } catch (err) {
    log.warn(`Gagal fetch GNews API: ${err.message}`);
    logScrapeResult('GNewsAPI', false, 0, err.message);
    return [];
  }
}

/**
 * Fetch GNews / Google News RSS sebagai fallback berita publik.
 */
async function fetchGNewsRss() {
  try {
    const gnewsRssUrl = 'https://news.google.com/rss/search?q=(gold+OR+XAUUSD+OR+Fed)&hl=en-US&gl=US&ceid=US:en';
    const res = await axios.get(gnewsRssUrl, { headers: getHeaders(), timeout: 8000, responseType: 'text' });
    const parsed = await xml2js.parseStringPromise(res.data);
    const items = parsed?.rss?.channel?.[0]?.item || [];

    logScrapeResult('GNewsRSS', true, items.length);

    return items
      .map(item => {
        const title = item.title?.[0] || 'Market News';
        const rawDate = item.pubDate?.[0] || '';
        const dateObj = parseToDateObj(rawDate);
        const wibInfo = formatWIBTime(dateObj);
        const link = item.link?.[0] || '#';
        const sourceName = item.source?.[0] ? (typeof item.source[0] === 'object' ? item.source[0]._ : item.source[0]) : 'GNews';

        const analysis = analyzeInvestingHeadline(title, 'GNews RSS');

        return {
          id: `gnews_rss_${dateObj.getTime()}_${title.slice(0, 15)}`,
          itemType: 'investing',
          source: sourceName,
          title,
          link,
          pubDate: rawDate,
          date: wibInfo.dateStr,
          timeWIB: wibInfo.displayWIB,
          timestamp: wibInfo.timestamp,
          category: 'GNews RSS',
          analysis,
          signal: analysis,
        };
      })
      .filter(item => isRelevantToXAUUSD(item.title));
  } catch (err) {
    log.warn(`Gagal fetch GNews RSS: ${err.message}`);
    logScrapeResult('GNewsRSS', false, 0, err.message);
    return [];
  }
}

/**
 * Ambil Feed Terpadu Realtime:
 * 1. Kalender Ekonomi: Forex Factory RSS XML
 * 2. News Headlines: ForexLive.com + NewsData.io API + GNews API + GNews RSS
 */
export async function getUnifiedFeed(forceRefresh = false) {
  const now = Date.now();

  if (!forceRefresh && unifiedCache.data && (now - unifiedCache.timestamp) < 30000) {
    return unifiedCache.data;
  }

  log.info('🌐 Mengambil & Memproses Feed Realtime (Forex Factory + ForexLive + News API)...');

  try {
    const [calendarEvents, forexLiveItems, newsDataIoItems, gnewsApiItems, gnewsRssItems] = await Promise.all([
      getHighImpactNews().catch(err => {
        log.error('Error in getHighImpactNews:', err.message);
        return [];
      }),
      fetchForexLiveRss().catch(() => []),
      fetchNewsDataIo().catch(() => []),
      fetchGNewsApi().catch(() => []),
      fetchGNewsRss().catch(() => []),
    ]);

    // Format Forex Factory calendar events
    const formattedCalendarItems = calendarEvents.map(evt => {
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
      };
    });

    // Combined headlines (ForexLive + NewsData.io + GNews API + GNews RSS)
    const allNewsHeadlines = [...forexLiveItems, ...newsDataIoItems, ...gnewsApiItems, ...gnewsRssItems];

    // Combine all (Forex Factory Calendar + News Headlines)
    const allCombined = [...formattedCalendarItems, ...allNewsHeadlines];

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

    // Enrich 10 headline berita terbaru menggunakan Groq AI
    const headlineItemsToAnalyze = deduplicated.filter(item => item.itemType === 'investing').slice(0, 10);
    await Promise.all(
      headlineItemsToAnalyze.map(async item => {
        const aiAnalysis = await analyzeHeadlineAsync(item.title, item.source);
        item.analysis = aiAnalysis;
        item.signal = aiAnalysis;
      })
    );

    log.info(`✅ Feed Realtime Berhasil: Total ${deduplicated.length} items (Forex Factory: ${formattedCalendarItems.length}, News Headlines: ${allNewsHeadlines.length})`);

    unifiedCache.data = deduplicated;
    unifiedCache.timestamp = now;
    return deduplicated;
  } catch (err) {
    log.error('Gagal membuat Unified Feed:', err.message);
    logScrapeResult('UnifiedFeed', false, 0, err.message);
    return unifiedCache.data || [];
  }
}
