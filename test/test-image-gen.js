import fs from 'fs';
import path from 'path';
import { analyzeSignal } from '../src/engine/signalEngine.js';
import { generateSignalCardImage } from '../src/formatter/imageGenerator.js';

async function testImageGen() {
  console.log('🧪 Testing Image Card Generation...');

  // Sample 1: Pre-Release Unemployment Claims (BUY)
  const event1 = {
    event: 'Unemployment Claims',
    actual: '-',
    forecast: '201K',
    previous: '197K',
    timeWIB: 'Kam, 1 Okt • 19.30 WIB',
    impact: 'medium',
  };
  const signal1 = analyzeSignal(event1);
  const buf1 = await generateSignalCardImage(event1, signal1);

  const outPath1 = path.resolve('test-unemployment-claims.png');
  fs.writeFileSync(outPath1, buf1);
  console.log(`✅ Generated: ${outPath1} (${buf1.length} bytes)`);

  // Sample 2: Pre-Release ISM Manufacturing PMI (SELL)
  const event2 = {
    event: 'ISM Manufacturing PMI',
    actual: '-',
    forecast: '54.8',
    previous: '54.6',
    timeWIB: 'Kam, 1 Okt • 21.00 WIB',
    impact: 'medium',
  };
  const signal2 = analyzeSignal(event2);
  const buf2 = await generateSignalCardImage(event2, signal2);

  const outPath2 = path.resolve('test-ism-pmi.png');
  fs.writeFileSync(outPath2, buf2);
  console.log(`✅ Generated: ${outPath2} (${buf2.length} bytes)`);

  console.log('🎉 Image generation test complete!');
}

testImageGen().catch(err => {
  console.error('❌ Image gen failed:', err);
  process.exit(1);
});
