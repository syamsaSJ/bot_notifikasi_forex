import axios from 'axios';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/New_York' });

const targets = [
  ['FF JSON', 'https://nfs.faireconomy.media/ff_calendar_thisweek.json'],
  ['Nasdaq Cal', `https://api.nasdaq.com/api/calendar/economicevents?date=${today}`],
  ['FXStreet Cal', `https://calendar-api.fxstreet.com/en/api/v1/eventDates/${today}T00:00:00Z/${today}T23:59:59Z?countries=US`],
  ['Investing Forex RSS', 'https://www.investing.com/rss/forex.rss'],
  ['Investing Econ RSS', 'https://www.investing.com/rss/news_14.rss'],
  ['FXStreet News RSS', 'https://www.fxstreet.com/rss/news'],
  ['FXStreet Analysis RSS', 'https://www.fxstreet.com/rss/analysis'],
  ['FXEmpire News', 'https://www.fxempire.com/api/v1/en/articles/rss/news'],
  ['FXEmpire Forecasts', 'https://www.fxempire.com/api/v1/en/articles/rss/forecasts'],
  ['InvestingLive (ForexLive)', 'https://investinglive.com/feed/'],
  ['ForexLive old', 'https://www.forexlive.com/feed/news'],
  ['DailyForex', 'https://www.dailyforex.com/rss/forexnews.xml'],
  ['Kitco', 'https://www.kitco.com/rss/KitcoNews.xml'],
  ['Google News Gold', 'https://news.google.com/rss/search?q=(gold+OR+XAUUSD+OR+%22US+dollar%22+OR+Fed)+when:1d&hl=en-US&gl=US&ceid=US:en'],
  ['FF HTML', 'https://www.forexfactory.com/calendar?day=today'],
];

for (const [name, url] of targets) {
  const t0 = Date.now();
  try {
    const res = await axios.get(url, {
      headers: { 'User-Agent': UA, 'Accept': '*/*', 'Accept-Language': 'en-US,en;q=0.9' },
      timeout: 12000,
      validateStatus: () => true,
      responseType: 'text',
      transformResponse: x => x,
    });
    const body = String(res.data || '');
    const pub = body.match(/<pubDate>([^<]+)<\/pubDate>/);
    const upd = body.match(/<(?:updated|dc:date)>([^<]+)</);
    console.log(`\n[${name}] ${res.status} ${Date.now() - t0}ms len=${body.length}`);
    if (pub || upd) console.log('   date sample:', (pub || upd)[1]);
    else console.log('   head:', body.slice(0, 300).replace(/\s+/g, ' '));
  } catch (e) {
    console.log(`\n[${name}] ERROR ${Date.now() - t0}ms ${e.code || ''} ${e.message}`);
  }
}
