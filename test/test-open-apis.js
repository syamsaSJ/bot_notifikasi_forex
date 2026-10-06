import axios from 'axios';

async function testOpenAPIs() {
  console.log('🌍 Testing Open Realtime Economic Calendar APIs...');

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  };

  // 1. ForexProstools (Investing.com Live Widget)
  try {
    console.log('\n1. Testing ForexProstools (Investing.com Widget)...');
    const res1 = await axios.get('https://ec.forexprostools.com/?columns=exc_flags,exc_currency,exc_importance,exc_actual,exc_forecast,exc_previous&importance=2,3&countries=5&calType=week', {
      headers: {
        ...headers,
        'Referer': 'https://www.investing.com/',
      },
      timeout: 8000,
    });
    console.log(`✅ ForexProstools Success! Bytes: ${res1.data?.length}`);
  } catch (err) {
    console.log('❌ ForexProstools Error:', err.message);
  }

  // 2. FinancialModelingPrep (Demo Economic Calendar API)
  try {
    console.log('\n2. Testing FinancialModelingPrep Economic Calendar API...');
    const res2 = await axios.get('https://financialmodelingprep.com/api/v3/economic_calendar?apikey=demo', {
      headers,
      timeout: 8000,
    });
    console.log(`✅ FinancialModelingPrep Success! Received ${res2.data?.length} events.`);
    if (res2.data?.length > 0) {
      console.log('Sample FMP Event:', res2.data[0]);
    }
  } catch (err) {
    console.log('❌ FMP Error:', err.message);
  }

  // 3. Trading Economics / Free Live Endpoint
  try {
    console.log('\n3. Testing TradingEconomics Free Calendar Endpoint...');
    const res3 = await axios.get('https://api.tradingeconomics.com/calendar?importance=2,3&c=guest:guest&format=json', {
      headers,
      timeout: 8000,
    });
    console.log(`✅ TradingEconomics Success! Received ${res3.data?.length} events.`);
    if (res3.data?.length > 0) {
      console.log('Sample TE Event:', res3.data[0]);
    }
  } catch (err) {
    console.log('❌ TradingEconomics Error:', err.message);
  }
}

testOpenAPIs();
