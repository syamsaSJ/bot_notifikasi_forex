import axios from 'axios';
import * as cheerio from 'cheerio';

async function testXMLFeed() {
  console.log('📡 Testing ForexFactory Official Developer XML Feed (cheerio XML mode)...');

  try {
    const res = await axios.get('https://www.forexfactory.com/ff_calendar_thisweek.xml', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/xml, text/xml, */*',
      },
      timeout: 12000,
    });

    console.log(`✅ XML Feed Received! Length: ${res.data?.length} bytes`);

    const $ = cheerio.load(res.data, { xmlMode: true });
    const events = [];

    $('event').each((_, el) => {
      const $el = $(el);
      const title = $el.find('title').text().trim();
      const country = $el.find('country').text().trim();
      const date = $el.find('date').text().trim();
      const time = $el.find('time').text().trim();
      const impact = $el.find('impact').text().trim();
      const forecast = $el.find('forecast').text().trim();
      const previous = $el.find('previous').text().trim();
      const actual = $el.find('actual').text().trim();

      if (country === 'USD') {
        events.push({
          title,
          country,
          date,
          time,
          impact,
          forecast: forecast || '-',
          previous: previous || '-',
          actual: actual || '-',
        });
      }
    });

    console.log(`🎉 Parsed ${events.length} USD events from XML Feed!`);
    if (events.length > 0) {
      console.log('Sample Live Event:', events[0]);
    }
  } catch (err) {
    console.log('❌ XML Feed Error:', err.message);
  }
}

testXMLFeed();
