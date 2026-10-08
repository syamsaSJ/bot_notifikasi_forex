import axios from 'axios';
import xml2js from 'xml2js';

async function testFeeds() {
  const urls = [
    'https://nfs.faireconomy.media/ff_calendar_thisweek.json',
    'https://nfs.faireconomy.media/ff_news_thisweek.json',
    'https://www.forexfactory.com/ff_news.xml',
    'https://www.forexfactory.com/rss.php',
    'https://www.forexfactory.com/news/feed',
    'https://www.forexfactory.com/feed/news',
    'https://investinglive.com/feed/',
  ];

  for (const u of urls) {
    try {
      console.log(`Checking ${u}...`);
      const res = await axios.get(u, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        },
        timeout: 5000,
        responseType: 'text',
      });
      console.log(`✅ SUCCESS ${u} -> Status ${res.status}, len ${res.data.length}`);
      if (res.data.includes('<rss') || res.data.includes('<?xml')) {
        const parsed = await xml2js.parseStringPromise(res.data);
        const items = parsed?.rss?.channel?.[0]?.item || [];
        console.log(`Found ${items.length} RSS items.`);
        if (items.length > 0) {
          console.log('Sample item:', items[0].title?.[0]);
        }
      }
    } catch (err) {
      console.log(`❌ FAIL ${u}: ${err.message}`);
    }
  }
}

testFeeds().catch(console.error);
