import axios from 'axios';

async function testMirrors() {
  console.log('🔍 Testing alternative real-time live APIs...');

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
  };

  // 1. FXStreet Live Calendar API
  try {
    console.log('\n1. Testing FXStreet Live Calendar API...');
    const urlFx = 'https://calendar-api.fxstreet.com/en/api/v1/eventDates?volatilities=HIGH,MEDIUM&currencies=USD';
    const resFx = await axios.get(urlFx, { headers, timeout: 8000 });
    console.log(`✅ FXStreet Live API Success! Items: ${resFx.data?.length}`);
    if (resFx.data?.length > 0) {
      console.log('Sample FXStreet Item:', resFx.data[0]);
    }
  } catch (err) {
    console.log('❌ FXStreet Error:', err.message);
  }

  // 2. Investing.com Live Calendar API Widget
  try {
    console.log('\n2. Testing Investing.com Widget API...');
    const urlInv = 'https://sslecal2.forexprostools.com/?columns=exc_flags,exc_currency,exc_importance,exc_actual,exc_forecast,exc_previous&importance=2,3&countries=5&calType=week';
    const resInv = await axios.get(urlInv, { headers, timeout: 8000 });
    console.log(`✅ Investing.com Success! Received ${resInv.data?.length} bytes`);
  } catch (err) {
    console.log('❌ Investing.com Error:', err.message);
  }

  // 3. ForexFactory via Proxy / Web Scraping Mirror
  try {
    console.log('\n3. Testing ForexFactory via Web Proxy Mirror...');
    const urlProxy = 'https://api.allorigins.win/raw?url=' + encodeURIComponent('https://nodedata.forexfactory.com/forex/calendar/thisweek.json');
    const resProxy = await axios.get(urlProxy, { timeout: 10000 });
    console.log(`✅ ForexFactory Proxy Success! Received ${resProxy.data?.length} events`);
    if (resProxy.data?.length > 0) {
      console.log('Sample Proxy Item:', resProxy.data[0]);
    }
  } catch (err) {
    console.log('❌ Proxy Error:', err.message);
  }
}

testMirrors();
