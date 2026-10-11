import fs from 'fs';
import path from 'path';
import axios from 'axios';
import xml2js from 'xml2js';
import config from '../utils/config.js';
import { createLogger } from '../utils/logger.js';
import { formatWIBTime, parseToDateObj, normalizeCalendarTitleKey } from './parser.js';

import { logScrapeResult } from '../utils/scrapeLogger.js';
import { getHighImpactNews } from './forexFactory.js';
import { analyzeSignal, analyzeInvestingHeadline, analyzeHeadlineAsync } from '../engine/signalEngine.js';
import { isRelevantToXAUUSD } from '../utils/newsFilter.js';
import { saveUnifiedFeedToSupabase, getFeedFromSupabase } from '../services/supabaseService.js';

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
 * Fetch headline berita dari Forex Factory (via Google News RSS Index).
 */
async function fetchForexFactoryNews() {
  const url = 'https://news.google.com/rss/search?q=site:forexfactory.com&hl=en-US&gl=US&ceid=US:en';
  try {
    const res = await axios.get(url, { headers: getHeaders(), timeout: 8000, responseType: 'text' });
    const parsed = await xml2js.parseStringPromise(res.data);
    const items = parsed?.rss?.channel?.[0]?.item || [];

    logScrapeResult('ForexFactoryNews', true, items.length);

    return items
      .map(item => {
        let title = item.title?.[0] || 'Forex Factory News';
        title = title.replace(/\s*-\s*Forex Factory\s*$/i, '');

        const rawDate = item.pubDate?.[0] || '';
        const dateObj = parseToDateObj(rawDate);
        const wibInfo = formatWIBTime(dateObj);
        const link = item.link?.[0] || 'https://www.forexfactory.com/news';
        const analysis = analyzeInvestingHeadline(title, 'Forex Factory News');

        return {
          id: `ff_news_${dateObj.getTime()}_${title.slice(0, 15)}`,
          itemType: 'investing',
          source: 'Forex Factory News',
          title,
          link,
          pubDate: rawDate,
          date: wibInfo.dateStr,
          timeWIB: wibInfo.displayWIB,
          timestamp: wibInfo.timestamp,
          category: 'Forex Factory',
          analysis,
          signal: analysis,
        };
      })
      .filter(item => isRelevantToXAUUSD(item.title));
  } catch (err) {
    log.warn(`Gagal fetch Forex Factory News: ${err.message}`);
    logScrapeResult('ForexFactoryNews', false, 0, err.message);
    return [];
  }
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
 * Fetch headline berita & analisis langsung dari TradingView API & Google News RSS fallback.
 */
async function fetchTradingViewNews() {
  const newsList = [];
  const seenTitles = new Set();

  // Primary: TradingView Symbol News API (OANDA:XAUUSD)
  try {
    const tvUrl = 'https://news-headlines.tradingview.com/v2/headlines?client=web&symbol=OANDA:XAUUSD&lang=en';
    const res = await axios.get(tvUrl, { headers: getHeaders(), timeout: 8000 });
    const items = res.data?.items || (Array.isArray(res.data) ? res.data : []);

    if (items.length > 0) {
      items.forEach(item => {
        const title = item.title || 'TradingView News';
        if (!title || seenTitles.has(title.toLowerCase())) return;
        seenTitles.add(title.toLowerCase());

        const pubSec = item.published ? Number(item.published) : Math.floor(Date.now() / 1000);
        const dateObj = new Date(pubSec * 1000);
        const wibInfo = formatWIBTime(dateObj);
        
        const sourceName = item.source ? `TradingView (${item.source})` : 'TradingView';
        const storyLink = item.storyPath ? `https://www.tradingview.com${item.storyPath}` : 'https://www.tradingview.com/news/';
        const analysis = analyzeInvestingHeadline(title, 'TradingView');

        newsList.push({
          id: `tv_${item.id || pubSec}_${title.slice(0, 15)}`,
          itemType: 'investing',
          source: sourceName,
          title,
          link: storyLink,
          pubDate: dateObj.toISOString(),
          date: wibInfo.dateStr,
          timeWIB: wibInfo.displayWIB,
          timestamp: wibInfo.timestamp,
          category: 'TradingView',
          analysis,
          signal: analysis,
        });
      });
    }
  } catch (err) {
    log.warn(`Gagal fetch TradingView Headlines API: ${err.message}`);
  }

  // Fallback / Secondary: Google News RSS for TradingView site
  try {
    const rssUrl = 'https://news.google.com/rss/search?q=site:tradingview.com+(gold+OR+XAUUSD+OR+Fed+OR+USD)&hl=en-US&gl=US&ceid=US:en';
    const res = await axios.get(rssUrl, { headers: getHeaders(), timeout: 8000, responseType: 'text' });
    const parsed = await xml2js.parseStringPromise(res.data);
    const items = parsed?.rss?.channel?.[0]?.item || [];

    items.forEach(item => {
      let title = item.title?.[0] || 'TradingView News';
      title = title.replace(/\s*-\s*TradingView\s*$/i, '');
      if (!title || seenTitles.has(title.toLowerCase())) return;
      seenTitles.add(title.toLowerCase());

      const rawDate = item.pubDate?.[0] || '';
      const dateObj = parseToDateObj(rawDate);
      const wibInfo = formatWIBTime(dateObj);
      const link = item.link?.[0] || 'https://www.tradingview.com';
      const analysis = analyzeInvestingHeadline(title, 'TradingView RSS');

      newsList.push({
        id: `tv_rss_${dateObj.getTime()}_${title.slice(0, 15)}`,
        itemType: 'investing',
        source: 'TradingView News',
        title,
        link,
        pubDate: rawDate,
        date: wibInfo.dateStr,
        timeWIB: wibInfo.displayWIB,
        timestamp: wibInfo.timestamp,
        category: 'TradingView',
        analysis,
        signal: analysis,
      });
    });
  } catch (err) {
    log.warn(`Gagal fetch TradingView GNews RSS: ${err.message}`);
  }

  const filtered = newsList.filter(item => isRelevantToXAUUSD(item.title));
  logScrapeResult('TradingViewNews', true, filtered.length);
  return filtered;
}

/**
 * Ambil Feed Terpadu Realtime:
 * 1. Kalender Ekonomi: RapidAPI Forex Factory Scraper (fallback: Puppeteer -> Forex Factory RSS XML)
 * 2. News Headlines: ForexLive.com + NewsData.io API + GNews API + GNews RSS + TradingView News
 */
export async function getUnifiedFeed(forceRefresh = false, range = 'realtime') {
  const now = Date.now();

  if (!forceRefresh && unifiedCache.data && (now - unifiedCache.timestamp) < 30000) {
    return unifiedCache.data;
  }

  log.info(`🌐 Mengambil & Memproses Feed Realtime (Forex Factory + TradingView + ForexLive + News API) [Range: ${range}]...`);

  try {
    const [calendarEvents, ffNewsItems, forexLiveItems, newsDataIoItems, gnewsApiItems, gnewsRssItems, tradingViewNewsItems] = await Promise.all([
      getHighImpactNews(forceRefresh, range).catch(err => {
        log.error('Error in getHighImpactNews:', err.message);
        return [];
      }),

      fetchForexFactoryNews().catch(() => []),
      fetchForexLiveRss().catch(() => []),
      fetchNewsDataIo().catch(() => []),
      fetchGNewsApi().catch(() => []),
      fetchGNewsRss().catch(() => []),
      fetchTradingViewNews().catch(() => []),
    ]);

    // Format Forex Factory calendar events
    const formattedCalendarItems = calendarEvents.map((evt, idx) => {
      const signal = analyzeSignal(evt);
      const currency = (evt.currency || 'USD').toUpperCase();
      const titleKey = normalizeCalendarTitleKey(evt.event || evt.title || '');
      const cleanTitle = titleKey || (evt.event || evt.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const uniqueId = evt.id || `cal_${evt.date}_${currency}_${cleanTitle}`;

      return {
        id: uniqueId,
        itemType: 'calendar',
        source: 'Forex Factory',
        event: evt.event,
        title: evt.event,
        date: evt.date,
        time: evt.time,
        timeWIB: evt.timeWIB,
        timestamp: evt.timestamp || Date.now(),
        currency: currency,
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

    // Combined headlines (Forex Factory News + ForexLive + NewsData.io + GNews API + GNews RSS + TradingView News)
    const allNewsHeadlines = [...ffNewsItems, ...forexLiveItems, ...newsDataIoItems, ...gnewsApiItems, ...gnewsRssItems, ...tradingViewNewsItems];

    // Combine all (Forex Factory Calendar + News Headlines)
    const allCombined = [...formattedCalendarItems, ...allNewsHeadlines];

    // Deduplikasi & Merging (Saling Mengisi data Actual tanpa kartu duplikat)
    const calendarMap = new Map();
    const newsMap = new Map();

    allCombined.forEach((item) => {
      if (item.itemType === 'calendar') {
        const titleKey = normalizeCalendarTitleKey(item.event || item.title);
        const key = `${item.date}_${item.currency || 'USD'}_${titleKey}`;

        if (!calendarMap.has(key)) {
          calendarMap.set(key, item);
        } else {
          // SALING MENGISI: Update existing record jika data rilis baru/lengkap tersedia
          const existing = calendarMap.get(key);

          // 1. Update Actual jika baru terisi
          if (item.actual && item.actual !== '-' && item.actual.trim() !== '') {
            existing.actual = item.actual;
            if (item.actualValue !== undefined) existing.actualValue = item.actualValue;
          }

          // 2. Update Forecast jika sebelumnya '-'
          if ((!existing.forecast || existing.forecast === '-') && item.forecast && item.forecast !== '-') {
            existing.forecast = item.forecast;
            if (item.forecastValue !== undefined) existing.forecastValue = item.forecastValue;
          }

          // 3. Update Previous jika sebelumnya '-'
          if ((!existing.previous || existing.previous === '-') && item.previous && item.previous !== '-') {
            existing.previous = item.previous;
            if (item.previousValue !== undefined) existing.previousValue = item.previousValue;
          }

          // 4. Update jam rilis WIB presisi jika tersedia
          if (item.timeWIB && item.timeWIB.includes('WIB') && (!existing.timeWIB || !existing.timeWIB.includes('WIB'))) {
            existing.timeWIB = item.timeWIB;
            existing.time = item.time;
            existing.timestamp = item.timestamp;
          }

          // 5. Hitung ulang Sinyal fundamental jika actual telah terisi
          const updatedSignal = analyzeSignal(existing);
          existing.signal = updatedSignal;
          existing.analysis = {
            signal: updatedSignal.signal,
            direction: updatedSignal.direction,
            impactText: updatedSignal.predictionText,
          };
        }
      } else {
        const cleanTitle = (item.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const key = `news_${item.date || ''}_${cleanTitle.slice(0, 35)}`;
        if (!newsMap.has(key)) {
          newsMap.set(key, item);
        }
      }
    });

    const deduplicated = [...Array.from(calendarMap.values()), ...Array.from(newsMap.values())];


    // Urutkan berdasarkan timestamp terbaru di atas
    deduplicated.sort((a, b) => b.timestamp - a.timestamp);

    // Enrich headline berita terbaru menggunakan Groq AI (Sekuensial + Cache untuk cegah rate limit 429)
    const headlineItemsToAnalyze = deduplicated.filter(item => item.itemType === 'investing').slice(0, 8);
    for (const item of headlineItemsToAnalyze) {
      const aiAnalysis = await analyzeHeadlineAsync(item.title, item.source);
      item.analysis = aiAnalysis;
      item.signal = aiAnalysis;
      await new Promise(r => setTimeout(r, 150));
    }

    log.info(`✅ Sync Data Feed Berhasil: Total ${deduplicated.length} items (Forex Factory: ${formattedCalendarItems.length}, News Headlines: ${allNewsHeadlines.length})`);

    // 1. Simpan/upsert seluruh data terbaru ke Supabase Database
    await saveUnifiedFeedToSupabase(deduplicated).catch(e => log.warn(`Gagal async save ke Supabase: ${e.message}`));

    // 2. Ambil tampilan data terpadu LANGSUNG dari Database Supabase!
    const dbFeed = await getFeedFromSupabase().catch(() => null);
    if (dbFeed && dbFeed.length > 0) {
      log.info(`⚡ Menyajikan ${dbFeed.length} data kalender & berita LANGSUNG dari Database Supabase!`);
      unifiedCache.data = dbFeed;
      unifiedCache.timestamp = now;
      return dbFeed;
    }

    unifiedCache.data = deduplicated;
    unifiedCache.timestamp = now;
    return deduplicated;
  } catch (err) {
    log.error('Gagal membuat Unified Feed:', err.message);
    logScrapeResult('UnifiedFeed', false, 0, err.message);

    // Fallback ke Supabase Database jika live fetch bermasalah
    const dbFallback = await getFeedFromSupabase().catch(() => null);
    if (dbFallback && dbFallback.length > 0) {
      log.info('📦 Menggunakan data fallback dari Database Supabase.');
      return dbFallback;
    }

    return unifiedCache.data || [];
  }
}
