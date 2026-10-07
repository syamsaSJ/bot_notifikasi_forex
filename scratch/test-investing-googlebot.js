import axios from 'axios';
import * as cheerio from 'cheerio';

async function testGooglebot() {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  };

  try {
    console.log('Fetching Investing.com Economic Calendar with Googlebot UA...');
    const res = await axios.get('https://www.investing.com/economic-calendar/', { headers, timeout: 8000 });
    console.log(`Status: ${res.status} | HTML Length: ${res.data.length}`);
    const $ = cheerio.load(res.data);
    const rows = $('tr.js-event-item');
    console.log(`Parsed ${rows.length} event rows from Investing.com HTML!`);
    rows.each((i, row) => {
      if (i < 5) {
        const time = $(row).find('td.first').text().trim() || $(row).find('td.time').text().trim();
        const cur = $(row).find('td.flagCur').text().trim();
        const title = $(row).find('td.event').text().trim();
        const act = $(row).find('td.act').text().trim();
        const fore = $(row).find('td.fore').text().trim();
        const prev = $(row).find('td.prev').text().trim();
        console.log(`  Event ${i+1}: [${time}] ${cur} ${title} | Act: ${act} | Fore: ${fore} | Prev: ${prev}`);
      }
    });
  } catch (err) {
    console.log('Googlebot fetch error:', err.message);
  }
}

testGooglebot();
