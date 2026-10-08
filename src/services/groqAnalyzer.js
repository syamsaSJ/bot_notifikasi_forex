import fs from 'fs';
import path from 'path';
import axios from 'axios';
import config from '../utils/config.js';
import { createLogger } from '../utils/logger.js';
import { logScrapeResult } from '../utils/scrapeLogger.js';

const log = createLogger('GroqAnalyzer');

const AI_CACHE_FILE = path.resolve('scratch', 'ai_analysis_cache.json');

// Memory & Disk cache untuk Groq AI Analysis
let aiDiskCache = {};

// Load cache dari disk jika ada
try {
  if (fs.existsSync(AI_CACHE_FILE)) {
    const raw = fs.readFileSync(AI_CACHE_FILE, 'utf-8');
    aiDiskCache = JSON.parse(raw);
    log.info(`💾 Memuat ${Object.keys(aiDiskCache).length} hasil analisis Groq AI dari cache disk.`);
  }
} catch (e) {
  log.warn(`Gagal membaca disk cache Groq AI: ${e.message}`);
}

function saveAiCache() {
  try {
    const dir = path.dirname(AI_CACHE_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(AI_CACHE_FILE, JSON.stringify(aiDiskCache, null, 2), 'utf-8');
  } catch (e) {
    log.warn(`Gagal menyimpan disk cache Groq AI: ${e.message}`);
  }
}

function getHeadlineKey(headline = '') {
  return String(headline).toLowerCase().trim().replace(/[^a-z0-9]/g, '');
}

// Model Groq terverifikasi aktif untuk akun pengguna
const GROQ_MODELS = [
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'qwen/qwen3.8-27b',
];

let rateLimitCooldownUntil = 0;

/**
 * Analisis sentimen berita XAU/USD menggunakan Groq AI dengan Disk Cache Hemat Token.
 * 
 * @param {string} headline - Judul/headline berita
 * @param {string} source - Sumber berita
 * @returns {Promise<Object|null>} - Result analisis atau null jika gagal/API error
 */
export async function analyzeHeadlineWithGroq(headline, source = '') {
  if (!headline) return null;

  const cacheKey = getHeadlineKey(headline);

  // 1. Cek jika sudah pernah dianalisis & ada di disk cache JSON (Hemat API Call & Token!)
  if (aiDiskCache[cacheKey]) {
    log.debug(`💾 Cache hit Groq AI untuk: "${headline.slice(0, 30)}..."`);
    return aiDiskCache[cacheKey];
  }

  // 2. Cek jika sedang dalam Cooldown Rate Limit (429)
  if (Date.now() < rateLimitCooldownUntil) {
    return null; // Fallback instan ke rule-based tanpa membebankan API
  }

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

        const resultObj = {
          signal: parsed.signal || 'NEUTRAL',
          impact: parsed.impact || 'MEDIUM',
          direction: parsed.direction || 'Pasar Konsolidasi ↔',
          impactText: parsed.impactText || 'Analisis Groq AI sentimen pasar.',
          recommendation: parsed.recommendation || 'HOLD / WAIT',
          aiAnalyzed: true,
          aiModel: model,
        };

        // Simpan ke disk cache JSON agar tidak perlu request ulang
        aiDiskCache[cacheKey] = resultObj;
        saveAiCache();

        return resultObj;
      }
    } catch (err) {
      if (err.response?.status === 429) {
        rateLimitCooldownUntil = Date.now() + 60000;
        log.warn('⚠️ Groq AI Rate Limit (429) terdeteksi. Cooldown 60s diaktifkan. Fallback instan ke rule-based.');
        break;
      }
      log.warn(`⚠️ Groq AI model ${model} gagal: ${err.message}. Mencoba model alternatif...`);
    }
  }

  logScrapeResult('GroqAI', false, 0, 'Semua model Groq gagal/timeout');
  return null;
}
