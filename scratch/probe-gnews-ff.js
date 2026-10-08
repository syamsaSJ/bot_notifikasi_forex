import axios from 'axios';
import xml2js from 'xml2js';

async function probeGNewsFF() {
  console.log('Testing Google News RSS for Forex Factory...');
  const urls = [
    'https://news.google.com/rss/search?q=site:forexfactory.com&hl=en-US&gl=US&ceid=US:en',
    'https://news.google.com/rss/search?q=%22Forex+Factory%22&hl=en-US&gl=US&ceid=US:en',
    'https://news.google.com/rss/search?q=Forex+Factory+gold&hl=en-US&gl=US&ceid=US:en',
  ];

  for (const u of urls) {
    try {
      console.log(`\nFetching ${u}...`);
      const res = await axios.get(u, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 6000,
        responseType: 'text',
      });
      console.log(`Status: ${res.status}, Len: ${res.data.length}`);
      const parsed = await xml2js.parseStringPromise(res.data);
      const items = parsed?.rss?.channel?.[0]?.item || [];
      console.log(`Found ${items.length} items.`);
      if (items.length > 0) {
        console.log('Sample item title:', items[0].title?.[0]);
        console.log('Sample item link:', items[0].link?.[0]);
        console.log('Sample item source:', items[0].source?.[0]);
      }
    } catch (err) {
      console.log('Failed:', err.message);
    }
  }
}

probeGNewsFF().catch(console.error);
