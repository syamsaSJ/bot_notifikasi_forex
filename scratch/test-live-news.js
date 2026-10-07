import { getHighImpactNews } from '../src/scraper/forexFactory.js';
import { analyzeSignal } from '../src/engine/signalEngine.js';

async function testLive() {
  console.log('Fetching live high impact news...');
  const events = await getHighImpactNews();
  console.log(`Fetched ${events.length} live events:`);
  events.forEach((e, idx) => {
    const signal = analyzeSignal(e);
    console.log(`\nEvent ${idx+1}:`, e.event);
    console.log(`  Time:`, e.timeWIB);
    console.log(`  Impact:`, e.impact);
    console.log(`  Actual:`, e.actual, '| Forecast:', e.forecast, '| Previous:', e.previous);
    console.log(`  Signal:`, signal.signal);
  });
}

testLive();
