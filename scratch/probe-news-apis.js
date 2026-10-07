import axios from 'axios';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const H = { 'User-Agent': UA, 'Accept': 'application/json, application/xml, text/xml, */*' };

const newsDataKey = process.env.NEWSDATA_API_KEY || 'pub_test';
const gnewsKey = process.env.GNEWS_API_KEY || 'test';

console.log('Testing Forex Factory XML, NewsData.io, and GNews API...');

// 1. Forex Factory RSS XML
try {
  const ffRes = await axios.get('https://nfs.faireconomy.media/ff_calendar_thisweek.xml', { headers: H, timeout: 8000, responseType: 'text' });
  console.log(`[Forex Factory RSS XML] Status: ${ffRes.status} Length: ${ffRes.data.length}`);
} catch (e) {
  console.log('[Forex Factory RSS XML] Error:', e.message);
}

// 2. NewsData.io API
try {
  const url = `https://newsdata.io/api/1/news?apikey=${newsDataKey}&q=gold%20OR%20xauusd%20OR%20fed&language=en`;
  const ndRes = await axios.get(url, { headers: H, timeout: 8000, validateStatus: () => true });
  console.log(`[NewsData.io API] Status: ${ndRes.status}`);
  if (ndRes.data?.results) {
    console.log(`   Retrieved ${ndRes.data.results.length} articles from NewsData.io`);
    console.log('   Sample:', ndRes.data.results[0]?.title);
  } else {
    console.log('   Response msg:', ndRes.data?.results?.message || JSON.stringify(ndRes.data).slice(0, 150));
  }
} catch (e) {
  console.log('[NewsData.io API] Error:', e.message);
}

// 3. GNews API
try {
  const url = `https://gnews.io/api/v4/search?q=gold%20OR%20xauusd%20OR%20fed&lang=en&apikey=${gnewsKey}`;
  const gnRes = await axios.get(url, { headers: H, timeout: 8000, validateStatus: () => true });
  console.log(`[GNews API] Status: ${gnRes.status}`);
  if (gnRes.data?.articles) {
    console.log(`   Retrieved ${gnRes.data.articles.length} articles from GNews API`);
    console.log('   Sample:', gnRes.data.articles[0]?.title);
  } else {
    console.log('   Response msg:', JSON.stringify(gnRes.data).slice(0, 150));
  }
} catch (e) {
  console.log('[GNews API] Error:', e.message);
}

// 4. Google News RSS (GNews RSS Fallback)
try {
  const gnewsRssUrl = 'https://news.google.com/rss/search?q=(gold+OR+XAUUSD+OR+Fed)&hl=en-US&gl=US&ceid=US:en';
  const gRss = await axios.get(gnewsRssUrl, { headers: H, timeout: 8000, responseType: 'text' });
  console.log(`[Google News / GNews RSS] Status: ${gRss.status} Length: ${gRss.data.length}`);
} catch (e) {
  console.log('[Google News / GNews RSS] Error:', e.message);
}
