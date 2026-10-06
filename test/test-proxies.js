import axios from 'axios';

async function testProxies() {
  console.log('🧪 Testing real-time proxy endpoints for ForexFactory...');

  // Proxy 1: AllOrigins GET API
  try {
    console.log('\n1. Testing AllOrigins GET API...');
    const targetUrl = encodeURIComponent('https://nodedata.forexfactory.com/forex/calendar/thisweek.json');
    const res1 = await axios.get(`https://api.allorigins.win/get?url=${targetUrl}`, { timeout: 10000 });
    if (res1.data && res1.data.contents) {
      const dataObj = typeof res1.data.contents === 'string' ? JSON.parse(res1.data.contents) : res1.data.contents;
      console.log(`✅ AllOrigins Success! Received ${dataObj?.length} items`);
      if (dataObj?.length > 0) {
        console.log('Sample item:', dataObj[0].title, '| Date:', dataObj[0].date);
      }
    }
  } catch (err) {
    console.log('❌ AllOrigins Error:', err.message);
  }

  // Proxy 2: CodeTabs Proxy API
  try {
    console.log('\n2. Testing CodeTabs Proxy API...');
    const url2 = 'https://api.codetabs.com/v1/proxy?quest=' + encodeURIComponent('https://nodedata.forexfactory.com/forex/calendar/thisweek.json');
    const res2 = await axios.get(url2, { timeout: 10000 });
    if (Array.isArray(res2.data)) {
      console.log(`✅ CodeTabs Success! Received ${res2.data.length} items`);
      console.log('Sample item:', res2.data[0].title, '| Date:', res2.data[0].date);
    }
  } catch (err) {
    console.log('❌ CodeTabs Error:', err.message);
  }

  // Proxy 3: CorsProxy.io
  try {
    console.log('\n3. Testing CorsProxy.io API...');
    const url3 = 'https://corsproxy.io/?https://nodedata.forexfactory.com/forex/calendar/thisweek.json';
    const res3 = await axios.get(url3, { timeout: 10000 });
    if (Array.isArray(res3.data)) {
      console.log(`✅ CorsProxy.io Success! Received ${res3.data.length} items`);
    }
  } catch (err) {
    console.log('❌ CorsProxy.io Error:', err.message);
  }
}

testProxies();
