import { getHighImpactNews } from '../src/scraper/forexFactory.js';
import { getInvestingNews } from '../src/scraper/investing.js';
import { analyzeSignal } from '../src/engine/signalEngine.js';

async function testBoth() {
  console.log('Testing Both APIs...');
  try {
    const events = await getHighImpactNews();
    console.log(`\nForexFactory High/Medium Impact USD Events (${events.length}):`);
    console.log(events);

    const news = await getInvestingNews();
    console.log(`\nInvesting.com News (${news.length}):`);
    console.log(news.slice(0, 3));
  } catch (err) {
    console.error('Error:', err);
  }
}

testBoth();
