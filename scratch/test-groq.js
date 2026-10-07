import { analyzeHeadlineWithGroq } from '../src/services/groqAnalyzer.js';

async function testGroq() {
  console.log('Testing Groq AI sentiment analysis...');
  const testHeadline = 'Gold surges above $2,650 as Federal Reserve signals aggressive rate cuts following weak inflation data';
  console.log('Headline:', testHeadline);

  const result = await analyzeHeadlineWithGroq(testHeadline, 'ForexLive');
  console.log('Groq AI Result:');
  console.dir(result, { depth: null });
}

testGroq().catch(console.error);
