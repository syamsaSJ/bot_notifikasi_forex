import axios from 'axios';
import config from '../utils/config.js';
import { createLogger } from '../utils/logger.js';
import { logScrapeResult } from '../utils/scrapeLogger.js';

const log = createLogger('GroqAnalyzer');

// Model Groq terverifikasi aktif untuk akun pengguna
const GROQ_MODELS = [
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'qwen/qwen3.8-27b',
];

/**
 * Analisis sentimen berita XAU/USD menggunakan Groq AI.
 * 
 * @param {string} headline - Judul/headline berita
 * @param {string} source - Sumber berita
 * @returns {Promise<Object|null>} - Result analisis atau null jika gagal/API error
 */
export async function analyzeHeadlineWithGroq(headline, source = '') {
  const apiKey = config.GROQ_API_KEY;
  if (!apiKey || apiKey.includes('your_')) {
    return null;
  }

  const prompt = `Anda adalah analis pasar keuangan profesional spesialis XAU/USD (Emas) dan Dolar AS (USD).
Analisis headline berita pasar berikut dan berikan penilaian dampaknya terhadap pasangan mata uang XAU/USD:

Headline: "${headline}"
Sumber: "${source}"

Ketentuan Sinyal:
- BUY: Berita memicu permintaan Emas (Safe Haven, inflasi turun, suku bunga Fed dipangkas, USD melemah, perang/konflik).
- SELL: Berita menekan harga Emas (Suku bunga Fed naik/tetap tinggi, USD menguat, data ekonomi AS membaik, yield obligasi naik).
- NEUTRAL: Berita sentimen campuran atau tidak berdampak langsung.

Tanggapi HANYA dengan JSON valid tanpa format markdown tambahan dengan skema berikut:
{
  "signal": "BUY" | "SELL" | "NEUTRAL",
  "impact": "HIGH" | "MEDIUM" | "LOW",
  "direction": "USD Melemah / Gold Safe Haven ↑" (atau "USD Menguat / Yield Surge ↓" atau "Pasar Konsolidasi ↔"),
  "impactText": "Penjelasan ringkas 1-2 kalimat Bahasa Indonesia tentang bagaimana berita mempengaruhi XAU/USD",
  "recommendation": "BUY XAU/USD" | "SELL XAU/USD" | "HOLD / WAIT"
}`;

  for (const model of GROQ_MODELS) {
    try {
      const res = await axios.post(
        'https://api.groq.com/openai/v1/chat/completions',
        {
          model,
          messages: [
            {
              role: 'system',
              content: 'Anda adalah AI analis kuantitatif pasar emas XAU/USD. Selalu kembalikan respons JSON murni.'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.1,
          response_format: { type: 'json_object' }
        },
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 7000
        }
      );

      const content = res.data?.choices?.[0]?.message?.content;
      if (content) {
        const parsed = JSON.parse(content);
        log.info(`🤖 Groq AI (${model}) Analysis Sukses: "${headline.slice(0, 35)}..." -> ${parsed.signal}`);
        logScrapeResult('GroqAI', true, 1);
        return {
          signal: parsed.signal || 'NEUTRAL',
          impact: parsed.impact || 'MEDIUM',
          direction: parsed.direction || 'Pasar Konsolidasi ↔',
          impactText: parsed.impactText || 'Analisis Groq AI sentimen pasar.',
          recommendation: parsed.recommendation || 'HOLD / WAIT',
          aiAnalyzed: true,
          aiModel: model,
        };
      }
    } catch (err) {
      log.warn(`⚠️ Groq AI model ${model} gagal: ${err.message}. Mencoba model alternatif...`);
    }
  }

  logScrapeResult('GroqAI', false, 0, 'Semua model Groq gagal/timeout');
  return null;
}
