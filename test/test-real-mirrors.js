import axios from 'axios';

async function testRealMirrors() {
  console.log('🔍 Testing live proxy mirrors for local Windows environment...');

  // 1. ThingProxy
  try {
    console.log('\n1. Testing ThingProxy live feed...');
    const url1 = 'https://thingproxy.freeboard.io/fetch/https://nodedata.forexfactory.com/forex/calendar/thisweek.json';
    const res1 = await axios.get(url1, { timeout: 8000 });
    console.log(`✅ ThingProxy Success! Items: ${res1.data?.length}`);
    if (res1.data?.length > 0) {
      console.log('Sample Event:', res1.data[0]);
    }
  } catch (err) {
    console.log('❌ ThingProxy Error:', err.message);
  }

  // 2. AllOrigins Contents API
  try {
    console.log('\n2. Testing AllOrigins Contents API...');
    const target = 'https://nodedata.forexfactory.com/forex/calendar/thisweek.json';
    const url2 = 'https://api.allorigins.win/get?url=' + encodeURIComponent(target);
    const res2 = await axios.get(url2, { timeout: 8000 });
    if (res2.data && res2.data.contents) {
      const parsed = JSON.parse(res2.data.contents);
      console.log(`✅ AllOrigins Success! Items: ${parsed?.length}`);
    }
  } catch (err) {
    console.log('❌ AllOrigins Error:', err.message);
  }

  // 3. WebScraper / Free Feed Proxy
  try {
    console.log('\n3. Testing Jsonproxy API...');
    const url3 = 'https://proxy.cors.sh/https://nodedata.forexfactory.com/forex/calendar/thisweek.json';
    const res3 = await axios.get(url3, { timeout: 8000 });
    console.log(`✅ Proxy.cors.sh Success! Items: ${res3.data?.length}`);
  } catch (err) {
    console.log('❌ Proxy.cors.sh Error:', err.message);
  }
}

testRealMirrors();
