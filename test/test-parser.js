/**
 * Test script untuk verifikasi parser dan signal engine.
 * Jalankan: node test/test-parser.js
 */

import { parseEconomicValue, convertETtoWIB } from '../src/scraper/parser.js';
import { analyzeSignal, isInvertedIndicator } from '../src/engine/signalEngine.js';
import { formatMessage, formatDailySummary } from '../src/formatter/messageFormatter.js';

let passed = 0;
let failed = 0;

function assert(condition, testName) {
  if (condition) {
    console.log(`  ✅ ${testName}`);
    passed++;
  } else {
    console.log(`  ❌ ${testName}`);
    failed++;
  }
}

// =====================================================
console.log('\n📦 TEST: parseEconomicValue()');
// =====================================================

assert(parseEconomicValue('120K') === 120000, '120K → 120000');
assert(parseEconomicValue('1.2M') === 1200000, '1.2M → 1200000');
assert(parseEconomicValue('2.5B') === 2500000000, '2.5B → 2500000000');
assert(parseEconomicValue('0.4%') === 0.4, '0.4% → 0.4');
assert(parseEconomicValue('-0.3%') === -0.3, '-0.3% → -0.3');
assert(parseEconomicValue('3.50') === 3.5, '3.50 → 3.5');
assert(parseEconomicValue('-1.2') === -1.2, '-1.2 → -1.2');
assert(parseEconomicValue('$1.5B') === 1500000000, '$1.5B → 1500000000');
assert(parseEconomicValue('-') === null, '"-" → null');
assert(parseEconomicValue('') === null, '"" → null');
assert(parseEconomicValue(null) === null, 'null → null');
assert(parseEconomicValue(undefined) === null, 'undefined → null');
assert(parseEconomicValue('197K') === 197000, '197K → 197000');
assert(parseEconomicValue('201K') === 201000, '201K → 201000');

// =====================================================
console.log('\n🕐 TEST: convertETtoWIB()');
// =====================================================

assert(convertETtoWIB('8:30am', '') === '20:30 WIB', '8:30am ET → 20:30 WIB');
assert(convertETtoWIB('10:00am', '') === '22:00 WIB', '10:00am ET → 22:00 WIB');
assert(convertETtoWIB('2:00pm', '') === '02:00 WIB', '2:00pm ET → 02:00 WIB (next day)');
assert(convertETtoWIB('All Day', '') === 'All Day', 'All Day → All Day');
assert(convertETtoWIB('Tentative', '') === 'Tentative', 'Tentative → Tentative');
assert(convertETtoWIB('', '') === 'TBD', '"" → TBD');

// =====================================================
console.log('\n🧠 TEST: analyzeSignal()');
// =====================================================

// Test 1: Pre-Release Unemployment Claims (Forecast 201K > Previous 197K) → BUY
const preUnemployment = analyzeSignal({
  event: 'Unemployment Claims',
  actual: '-',
  forecast: '201K',
  previous: '197K',
});
assert(preUnemployment.signal === 'BUY', 'Pre-Release Unemployment Claims (201K > 197K) → BUY');
assert(preUnemployment.predictionText.includes('USD diperkirakan melemah'), 'Pre-Release Unemployment Claims text contains "USD diperkirakan melemah"');

// Test 2: Pre-Release ISM Manufacturing PMI (Forecast 54.8 > Previous 54.6) → SELL
const prePMI = analyzeSignal({
  event: 'ISM Manufacturing PMI',
  actual: '-',
  forecast: '54.8',
  previous: '54.6',
});
assert(prePMI.signal === 'SELL', 'Pre-Release ISM Manufacturing PMI (54.8 > 54.6) → SELL');
assert(prePMI.predictionText.includes('USD diperkirakan menguat'), 'Pre-Release PMI text contains "USD diperkirakan menguat"');

// Test 3: Post-Release USD Melemah (Actual < Forecast) → BUY
const buySignal = analyzeSignal({
  event: 'Non-Farm Employment Change',
  actual: '120K',
  forecast: '180K',
  previous: '150K',
});
assert(buySignal.signal === 'BUY', 'NFP 120K < 180K → BUY');
assert(buySignal.direction.includes('Melemah'), 'NFP → USD Melemah');

// Test 4: Post-Release USD Menguat (Actual > Forecast) → SELL
const sellSignal = analyzeSignal({
  event: 'Core CPI m/m',
  actual: '0.4%',
  forecast: '0.2%',
  previous: '0.3%',
});
assert(sellSignal.signal === 'SELL', 'CPI 0.4% > 0.2% → SELL');
assert(sellSignal.direction.includes('Menguat'), 'CPI → USD Menguat');

// Test 5: Netral (Actual = Forecast) → HOLD
const holdSignal = analyzeSignal({
  event: 'GDP',
  actual: '2.5%',
  forecast: '2.5%',
  previous: '2.3%',
});
assert(holdSignal.signal === 'HOLD', 'GDP 2.5% = 2.5% → HOLD');

// Test 6: Inverted indicator post-release (Unemployment Claims)
const invertedSignal = analyzeSignal({
  event: 'Unemployment Claims',
  actual: '190K',
  forecast: '210K',
  previous: '200K',
});
assert(invertedSignal.signal === 'SELL', 'Unemployment Claims 190K < 210K → SELL (inverted)');

const invertedBuySignal = analyzeSignal({
  event: 'Unemployment Claims',
  actual: '230K',
  forecast: '210K',
  previous: '200K',
});
assert(invertedBuySignal.signal === 'BUY', 'Unemployment Claims 230K > 210K → BUY (inverted)');

// =====================================================
console.log('\n🔄 TEST: isInvertedIndicator()');
// =====================================================

assert(isInvertedIndicator('Unemployment Claims') === true, 'Unemployment Claims → inverted');
assert(isInvertedIndicator('Initial Jobless Claims') === true, 'Initial Jobless Claims → inverted');
assert(isInvertedIndicator('Non-Farm Employment Change') === false, 'NFP → not inverted');
assert(isInvertedIndicator('Core CPI m/m') === false, 'CPI → not inverted');

// =====================================================
console.log('\n📨 TEST: formatMessage()');
// =====================================================

const buyEvent = {
  event: 'Unemployment Claims',
  actual: '-',
  forecast: '201K',
  previous: '197K',
  timeWIB: '19:30 WIB',
  impact: 'medium',
};
const buyMsg = formatMessage(buyEvent, preUnemployment);
assert(typeof buyMsg === 'string' && buyMsg.length > 50, 'Card message formatted (length > 50)');
assert(buyMsg.includes('BUY'), 'Card message contains "BUY"');
assert(buyMsg.includes('201K'), 'Card message contains "201K"');

const pmiEvent = {
  event: 'ISM Manufacturing PMI',
  actual: '-',
  forecast: '54.8',
  previous: '54.6',
  timeWIB: '21:00 WIB',
  impact: 'medium',
};
const pmiMsg = formatMessage(pmiEvent, prePMI);
assert(typeof pmiMsg === 'string' && pmiMsg.length > 50, 'PMI message formatted (length > 50)');
assert(pmiMsg.includes('SELL'), 'PMI message contains "SELL"');

// =====================================================
console.log('\n📅 TEST: formatDailySummary()');
// =====================================================

const emptySum = formatDailySummary([]);
assert(emptySum.includes('Tidak ada'), 'Empty summary shows "Tidak ada" message');

const fullSum = formatDailySummary([buyEvent, pmiEvent]);
assert(fullSum.includes('2'), 'Summary with 2 events shows count');

// =====================================================
console.log('\n📰 TEST: formatInvestingSummary()');
// =====================================================

import { formatInvestingSummary } from '../src/scraper/investing.js';
const emptyInv = formatInvestingSummary([]);
assert(emptyInv.includes('Tidak ada berita'), 'Empty Investing summary shows "Tidak ada berita"');

const sampleNews = [{ title: 'EUR/USD Forecast', timeWIB: 'Kam, 1 Okt • 18.00 WIB', category: 'Forex' }];
const formattedInv = formatInvestingSummary(sampleNews);
assert(formattedInv.includes('EUR/USD Forecast'), 'Formatted Investing summary includes title');

// =====================================================
// Summary
// =====================================================
console.log('\n═══════════════════════════════════');
console.log(`📊 Hasil: ${passed} passed, ${failed} failed`);
console.log('═══════════════════════════════════\n');

if (failed > 0) {
  process.exit(1);
}

