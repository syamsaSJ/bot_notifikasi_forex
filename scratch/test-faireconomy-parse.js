import axios from 'axios';
import { parseEconomicValue } from '../src/scraper/parser.js';

async function testFairEconomyParse() {
  console.log('Testing FairEconomy JSON Feed Parsing...');

  try {
    const res = await axios.get('https://nfs.faireconomy.media/ff_calendar_thisweek.json', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*'
      },
      timeout: 10000
    });

    console.log('Fetch Status:', res.status, '| Total raw items:', res.data.length);
    console.log('Raw sample item 0:', res.data[0]);

    // Filter USD
    const usdRaw = res.data.filter(item => item && (item.country === 'USD' || item.currency === 'USD'));
    console.log('Total USD items:', usdRaw.length);

    usdRaw.forEach((item, idx) => {
      console.log(`\nUSD Item ${idx+1}:`);
      console.log('  title:', item.title);
      console.log('  country:', item.country);
      console.log('  date:', item.date);
      console.log('  impact:', item.impact);
      console.log('  actual:', item.actual, '| forecast:', item.forecast, '| previous:', item.previous);
    });

  } catch (err) {
    console.error('Error:', err.message);
  }
}

testFairEconomyParse();
