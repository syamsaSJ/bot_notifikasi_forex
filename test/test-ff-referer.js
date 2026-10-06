import axios from 'axios';

async function testFFReferer() {
  console.log('📡 Testing ForexFactory JSON API with Referer header...');

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Referer': 'https://www.forexfactory.com/',
    'Origin': 'https://www.forexfactory.com',
  };

  try {
    const res = await axios.get('https://nodedata.forexfactory.com/forex/calendar/thisweek.json', {
      headers,
      timeout: 10000,
    });
    console.log(`\n🎉 SUCCESS! Received ${res.data?.length} live events from ForexFactory JSON API!`);
    if (res.data?.length > 0) {
      console.log('Sample Live Event:', res.data[0]);
    }
  } catch (err) {
    console.log('❌ Referer test error:', err.message);
  }
}

testFFReferer();
