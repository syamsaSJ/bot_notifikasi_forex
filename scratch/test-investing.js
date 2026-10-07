import axios from 'axios';
import parseString from 'xml2js';

async function testMoreInvesting() {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  };

  const feeds = [
    { name: 'Forex News', url: 'https://www.investing.com/rss/forex.rss' },
    { name: 'Economic Indicators', url: 'https://www.investing.com/rss/news_14.rss' },
    { name: 'Commodities & Gold News', url: 'https://www.investing.com/rss/news_11.rss' },
    { name: 'Market Overview', url: 'https://www.investing.com/rss/market_overview.rss' }
  ];

  console.log('--- Testing Investing.com RSS Feeds ---');
  for (const feed of feeds) {
    try {
      const res = await axios.get(feed.url, { headers, timeout: 5000 });
      parseString.parseString(res.data, (err, result) => {
        if (!err && result?.rss?.channel?.[0]?.item) {
          const items = result.rss.channel[0].item;
          console.log(`\n✅ ${feed.name}: ${items.length} berita ditemukan.`);
          items.slice(0, 3).forEach(it => {
            console.log(`  - ${it.title?.[0]} (${it.pubDate?.[0]})`);
          });
        }
      });
    } catch (err) {
      console.log(`❌ ${feed.name} Error: ${err.message}`);
    }
  }
}

testMoreInvesting();
