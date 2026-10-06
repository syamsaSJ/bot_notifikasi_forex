import axios from 'axios';

async function testLiveFetch() {
  console.log('🌐 Testing live ForexFactory endpoints...');

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
  };

  // Test 1: JSON API endpoint
  try {
    console.log('1. Trying nodedata.forexfactory.com JSON endpoint...');
    const resJson = await axios.get('https://nodedata.forexfactory.com/forex/calendar/thisweek.json', {
      headers,
      timeout: 15000,
    });
    console.log(`✅ JSON API Success! Received ${resJson.data?.length} events`);
    if (resJson.data?.length > 0) {
      console.log('Sample Event:', resJson.data[0]);
    }
  } catch (err) {
    console.log('❌ JSON API Error:', err.message);
  }

  // Test 2: HTML Calendar page
  try {
    console.log('2. Trying forexfactory.com calendar HTML page...');
    const resHtml = await axios.get('https://www.forexfactory.com/calendar?day=today', {
      headers,
      timeout: 15000,
    });
    console.log(`✅ HTML Success! Received ${resHtml.data?.length} characters`);
  } catch (err) {
    console.log('❌ HTML Error:', err.message);
  }
}

testLiveFetch();
