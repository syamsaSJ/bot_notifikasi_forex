/**
 * Test suite otomatis untuk verifikasi parser, konversi waktu WIB, dan signal engine.
 * Jalankan: npm test
 */

import { parseEconomicValue, convertETtoWIB, formatWIBTime, parseToDateObj } from '../src/scraper/parser.js';
import { analyzeSignal, isInvertedIndicator } from '../src/engine/signalEngine.js';
import { formatMessage, formatDailySummary, formatHeadlineDigest } from '../src/formatter/messageFormatter.js';
import { logScrapeResult, getScrapeLogs, getSourceHealth, formatLogsTelegram } from '../src/utils/scrapeLogger.js';

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
assert(parseEconomicValue('-') === null, '"-" → null');
assert(parseEconomicValue('&nbsp;') === null, '"&nbsp;" → null');

// =====================================================
console.log('\n🕐 TEST: Konversi Waktu WIB & Parser Date');
// =====================================================

// Test 1: Fixing Investing.com GMT date string '2026-10-07 01:18:58'
const gmtStr = '2026-10-07 01:18:58';
const parsedDate = parseToDateObj(gmtStr);
const wibRes = formatWIBTime(parsedDate);
assert(wibRes.timeWIBStr === '08:18 WIB', `GMT '2026-10-07 01:18:58' → '08:18 WIB' (diterima: ${wibRes.timeWIBStr})`);

// Test 2: ET Conversion
assert(convertETtoWIB('8:30am', '') === '20:30 WIB', '8:30am ET → 20:30 WIB');
assert(convertETtoWIB('10:00am', '') === '22:00 WIB', '10:00am ET → 22:00 WIB');

// =====================================================
console.log('\n🧠 TEST: Signal Engine & Inverted Indicators');
// =====================================================

const preUnemployment = analyzeSignal({
  event: 'Unemployment Claims',
  actual: '-',
  forecast: '201K',
  previous: '197K',
});
assert(preUnemployment.signal === 'BUY', 'Pre-Release Unemployment Claims (201K > 197K) → BUY');

const prePMI = analyzeSignal({
  event: 'ISM Manufacturing PMI',
  actual: '-',
  forecast: '54.8',
  previous: '54.6',
});
assert(prePMI.signal === 'SELL', 'Pre-Release ISM Manufacturing PMI (54.8 > 54.6) → SELL');

assert(isInvertedIndicator('Unemployment Claims') === true, 'Unemployment Claims → Inverted');
assert(isInvertedIndicator('Non-Farm Employment Change') === false, 'NFP → Normal');

// =====================================================
console.log('\n📋 TEST: Scrape Logger & Error Tracking');
// =====================================================

logScrapeResult('TestScraperOK', true, 15);
logScrapeResult('TestScraperFail', false, 0, 'Connection Timeout 5000ms');

const health = getSourceHealth();
assert(health.TestScraperOK.status === 'OK', 'Logger records OK status');
assert(health.TestScraperFail.status === 'ERROR', 'Logger records ERROR status');

const logs = getScrapeLogs();
assert(logs.length >= 2, 'Scrape memory logs buffer working');

const tgLogMsg = formatLogsTelegram();
assert(tgLogMsg.includes('STATUS & LOG SCRAPING'), 'Telegram logs message formatted');

// =====================================================
// Summary
// =====================================================
console.log('\n═══════════════════════════════════');
console.log(`📊 Hasil Test: ${passed} passed, ${failed} failed`);
console.log('═══════════════════════════════════\n');

if (failed > 0) {
  process.exit(1);
}
