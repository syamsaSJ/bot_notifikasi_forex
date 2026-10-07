import { parseEconomicValue } from '../scraper/parser.js';
import { createLogger } from '../utils/logger.js';
import { analyzeHeadlineWithGroq } from '../services/groqAnalyzer.js';

const log = createLogger('SignalEngine');

/**
 * Daftar indikator ekonomi dimana angka LEBIH RENDAH justru BAGUS untuk USD.
 * Untuk indikator ini, logika dibalik:
 *   Actual < Forecast → USD Menguat (karena lebih rendah = lebih baik)
 *   Actual > Forecast → USD Melemah (karena lebih tinggi = lebih buruk)
 */
const INVERTED_INDICATORS = [
  'unemployment claims',
  'initial jobless claims',
  'continuing jobless claims',
  'trade balance',
  'budget balance',
  'current account',
];

/**
 * Cek apakah indikator termasuk "inverted".
 */
export function isInvertedIndicator(eventName) {
  const lower = (eventName || '').toLowerCase();
  return INVERTED_INDICATORS.some(inv => lower.includes(inv));
}

/**
 * Filter utama relevansi pergerakan XAU/USD GOLD.
 * Hanya mengembalikan true jika berita/event berkaitan langsung dengan Emas, Suku Bunga Fed, USD, Inflasi, Tenaga Kerja US, atau Geopolitik.
 * @param {Object} item - Event kalender atau headline berita
 * @returns {boolean}
 */
export function isGoldRelevant(item) {
  const title = (item.event || item.title || '').toLowerCase();
  const category = (item.category || '').toLowerCase();
  const source = (item.source || '').toLowerCase();
  const fullText = `${title} ${category} ${source}`;

  // 1. Keyword Langsung Emas & Logam Mulia
  const goldKeywords = ['gold', 'xau', 'xauusd', 'yellow metal', 'bullion', 'precious metal'];
  if (goldKeywords.some(kw => fullText.includes(kw))) {
    return true;
  }

  // 2. Keyword Utama Penggerak USD & Suku Bunga Fed (Makroekonomi US)
  const usdFedKeywords = [
    'fed', 'fomc', 'powell', 'dollar', 'usd', 'dxy', 'greenback', 'treasury', 'yield',
    'interest rate', 'rate cut', 'rate hike', 'monetary policy', 'central bank',
    'inflation', 'cpi', 'ppi', 'pce', 'nfp', 'payroll', 'unemployment', 'jobless',
    'non-farm', 'gdp', 'pmi', 'retail sales', 'uom consumer', 'michigan sentiment',
    'cb consumer confidence', 'trade balance', 'fomc meeting', 'fomc minutes'
  ];

  // 3. Keyword Geopolitik & Risk Sentiment
  const geoKeywords = ['geopolitical', 'safe haven', 'safe-haven', 'war', 'middle east', 'tariff', 'recession', 'debt ceiling'];

  const matchesUsdFed = usdFedKeywords.some(kw => fullText.includes(kw));
  const matchesGeo = geoKeywords.some(kw => fullText.includes(kw));

  if (matchesUsdFed || matchesGeo) {
    // Filter pengecualian (Exclude berita minyak/gas/mikro lokal jika TIDAK menyebut Emas)
    const excludeKeywords = ['crude oil', 'gasoline', 'natural gas', 'mortgage', 'car sales', 'truck sales', 'api weekly', 'eia crude'];
    if (excludeKeywords.some(ex => fullText.includes(ex)) && !goldKeywords.some(gkw => fullText.includes(gkw))) {
      return false;
    }
    return true;
  }

  return false;
}

/**
 * Analisis sinyal XAU/USD berdasarkan data ekonomi.
 */
export function analyzeSignal(event) {
  const { actual, forecast, previous, event: eventName } = event;

  const actualVal = parseEconomicValue(actual);
  const forecastVal = parseEconomicValue(forecast);
  const previousVal = parseEconomicValue(previous);
  const isInverted = isInvertedIndicator(eventName);

  // KASUS PRE-RELEASE
  if (actualVal === null) {
    if (forecastVal !== null && previousVal !== null) {
      const diff = forecastVal - previousVal;

      if (Math.abs(diff) < 0.0001) {
        return {
          signal: 'HOLD',
          isPreRelease: true,
          direction: 'USD Stabil (Forecast = Previous)',
          xauDirection: 'XAU/USD Sideways',
          emoji: '⚪',
          reason: `Forecast (${forecast}) = Previous (${previous})`,
          predictionText: 'USD diperkirakan stabil (forecast sama dengan data sebelumnya). Hubungan terbalik emas & USD memproyeksikan XAU/USD konsolidasi.',
          analysis: 'Forecast sama dengan data periode sebelumnya.',
          strength: 'Netral',
        };
      }

      const usdStrong = isInverted ? diff < 0 : diff > 0;

      if (usdStrong) {
        return {
          signal: 'SELL',
          isPreRelease: true,
          direction: 'USD diperkirakan menguat',
          xauDirection: 'XAU/USD diperkirakan melemah',
          emoji: '🔴',
          reason: `Forecast (${forecast}) vs Previous (${previous}) → USD Menguat`,
          predictionText: 'USD diperkirakan menguat (data lebih baik). Hubungan terbalik emas & USD memproyeksikan XAU/USD melemah. Rekomendasi SELL.',
          analysis: `Perkiraan sebelum rilis: Forecast (${forecast}) lebih baik dibanding Previous (${previous}).`,
          strength: 'Sedang',
        };
      } else {
        return {
          signal: 'BUY',
          isPreRelease: true,
          direction: 'USD diperkirakan melemah',
          xauDirection: 'XAU/USD diperkirakan menguat',
          emoji: '🟢',
          reason: `Forecast (${forecast}) vs Previous (${previous}) → USD Melemah`,
          predictionText: 'USD diperkirakan melemah (data lebih buruk). Hubungan terbalik emas & USD memproyeksikan XAU/USD menguat. Rekomendasi BUY.',
          analysis: `Perkiraan sebelum rilis: Forecast (${forecast}) lebih buruk dibanding Previous (${previous}).`,
          strength: 'Sedang',
        };
      }
    }

    return {
      signal: 'PENDING',
      isPreRelease: true,
      direction: 'Menunggu Data',
      xauDirection: 'Belum Diketahui',
      emoji: '⏳',
      reason: 'Data belum dirilis dan perbandingan Forecast vs Previous tidak lengkap',
      predictionText: 'Menunggu rilis data resmi penggerak XAU/USD.',
      analysis: forecastVal !== null
        ? `Jika Actual < ${forecast} → USD Melemah → BUY XAUUSD\nJika Actual > ${forecast} → USD Menguat → SELL XAUUSD`
        : 'Forecast dan Previous tidak lengkap, menunggu rilis data.',
      strength: 'N/A',
    };
  }

  // KASUS POST-RELEASE
  if (forecastVal === null) {
    if (previousVal !== null) {
      return analyzeWithPrevious(actualVal, previousVal, actual, previous, eventName);
    }
    return {
      signal: 'NEUTRAL',
      isPreRelease: false,
      direction: 'Tidak Bisa Dianalisis',
      xauDirection: 'N/A',
      emoji: '⚪',
      reason: 'Forecast dan Previous tidak tersedia',
      predictionText: 'Data tidak cukup untuk analisis.',
      analysis: 'Data tidak cukup untuk analisis.',
      strength: 'N/A',
    };
  }

  const diff = actualVal - forecastVal;
  const percentDiff = forecastVal !== 0 ? Math.abs(diff / forecastVal) * 100 : 0;

  let strength = 'Lemah';
  if (percentDiff > 20) strength = 'Sangat Kuat';
  else if (percentDiff > 10) strength = 'Kuat';
  else if (percentDiff > 5) strength = 'Sedang';

  if (Math.abs(diff) < 0.0001) {
    return {
      signal: 'HOLD',
      isPreRelease: false,
      direction: 'Netral',
      xauDirection: 'XAU/USD Sideways',
      emoji: '⚪',
      reason: `Actual (${actual}) = Forecast (${forecast}) → Netral`,
      predictionText: `USD netral. Actual (${actual}) sesuai dengan Forecast (${forecast}). Hubungan terbalik emas & USD memproyeksikan XAU/USD konsolidasi.`,
      analysis: 'Data sesuai ekspektasi.',
      strength: 'Netral',
    };
  }

  const usdStrong = isInverted ? diff < 0 : diff > 0;

  if (usdStrong) {
    return {
      signal: 'SELL',
      isPreRelease: false,
      direction: 'USD Menguat ↑',
      xauDirection: 'XAU/USD Melemah ↓',
      emoji: '🔴',
      reason: `Actual (${actual}) ${isInverted ? '<' : '>'} Forecast (${forecast}) → USD Menguat`,
      predictionText: 'USD menguat (data lebih baik). Hubungan terbalik emas & USD memproyeksikan XAU/USD melemah. Rekomendasi SELL.',
      analysis: `Hasil Rilis: Actual (${actual}) vs Forecast (${forecast}). Hubungan terbalik emas & USD memproyeksikan XAU/USD melemah.`,
      strength,
    };
  } else {
    return {
      signal: 'BUY',
      isPreRelease: false,
      direction: 'USD Melemah ↓',
      xauDirection: 'XAU/USD Menguat ↑',
      emoji: '🟢',
      reason: `Actual (${actual}) ${isInverted ? '>' : '<'} Forecast (${forecast}) → USD Melemah`,
      predictionText: 'USD melemah (data lebih buruk). Hubungan terbalik emas & USD memproyeksikan XAU/USD menguat. Rekomendasi BUY.',
      analysis: `Hasil Rilis: Actual (${actual}) vs Forecast (${forecast}). Hubungan terbalik emas & USD memproyeksikan XAU/USD menguat.`,
      strength,
    };
  }
}

function analyzeWithPrevious(actualVal, previousVal, actual, previous, eventName) {
  const isInverted = isInvertedIndicator(eventName);
  const diff = actualVal - previousVal;

  if (Math.abs(diff) < 0.0001) {
    return {
      signal: 'HOLD',
      isPreRelease: false,
      direction: 'Netral',
      xauDirection: 'XAU/USD Sideways',
      emoji: '⚪',
      reason: `Actual (${actual}) = Previous (${previous}) → Netral`,
      predictionText: 'USD netral dibanding periode sebelumnya. Hubungan terbalik memproyeksikan XAU/USD konsolidasi.',
      analysis: 'Data sama dengan periode sebelumnya.',
      strength: 'Netral',
    };
  }

  const usdStrong = isInverted ? diff < 0 : diff > 0;

  if (usdStrong) {
    return {
      signal: 'SELL',
      isPreRelease: false,
      direction: 'USD Menguat ↑',
      xauDirection: 'XAU/USD Melemah ↓',
      emoji: '🔴',
      reason: `Actual (${actual}) vs Previous (${previous}) → USD Menguat`,
      predictionText: 'USD menguat dibanding periode lalu (data lebih baik). Hubungan terbalik emas & USD memproyeksikan XAU/USD melemah. Rekomendasi SELL.',
      analysis: 'Dibandingkan dengan Previous.',
      strength: 'Sedang',
    };
  } else {
    return {
      signal: 'BUY',
      isPreRelease: false,
      direction: 'USD Melemah ↓',
      xauDirection: 'XAU/USD Menguat ↑',
      emoji: '🟢',
      reason: `Actual (${actual}) vs Previous (${previous}) → USD Melemah`,
      predictionText: 'USD melemah dibanding periode lalu (data lebih buruk). Hubungan terbalik emas & USD memproyeksikan XAU/USD menguat. Rekomendasi BUY.',
      analysis: 'Dibandingkan dengan Previous.',
      strength: 'Sedang',
    };
  }
}

/**
 * Analisis dampak berita pasar Investing.com terhadap XAU/USD (Emas) & USD.
 */
export function analyzeInvestingHeadline(title = '', category = '') {
  const lower = title.toLowerCase();

  // Keyword Bullish Emas (BUY XAU/USD)
  const buyKeywords = [
    'cut rate', 'rate cut', 'fed dovish', 'usd fall', 'dollar drop', 'dollar slip',
    'gold rally', 'gold surge', 'gold jump', 'gold rise', 'gold gain', 'safe haven',
    'inflation cool', 'geopolitical', 'war', 'recession', 'debt crisis', 'yield drop', 'tariff'
  ];

  // Keyword Bearish Emas (SELL XAU/USD)
  const sellKeywords = [
    'rate hike', 'fed hawkish', 'usd surge', 'dollar rally', 'dollar gain',
    'yield surge', 'yield rise', 'yield hold', 'inflation rise', 'strong usd',
    'strong dollar', 'gold fall', 'gold drop', 'gold slip', 'jobs surge'
  ];

  const hasBuy = buyKeywords.some(kw => lower.includes(kw));
  const hasSell = sellKeywords.some(kw => lower.includes(kw));

  if (hasBuy && !hasSell) {
    return {
      signal: 'BUY',
      impact: 'HIGH',
      direction: 'USD Melemah / Gold Safe Haven ↑',
      impactText: 'Sentimen berita memicu kenaikan permintaan Emas (XAU/USD) atau melemahkan USD.',
      recommendation: 'BUY XAU/USD'
    };
  }

  if (hasSell && !hasBuy) {
    return {
      signal: 'SELL',
      impact: 'HIGH',
      direction: 'USD Menguat / Yield Surge ↓',
      impactText: 'Sentimen berita mendorong penguatan USD atau imbal hasil obligasi, memberikan tekanan jual pada Emas.',
      recommendation: 'SELL XAU/USD'
    };
  }

  return {
    signal: 'NEUTRAL',
    impact: 'MEDIUM',
    direction: 'Pasar Konsolidasi ↔',
    impactText: 'Berita memberikan sentimen campuran atau netral terhadap pergerakan XAU/USD.',
    recommendation: 'HOLD / WAIT'
  };
}

/**
 * Analisis headline berita menggunakan Groq AI terlebih dahulu,
 * dengan fallback ke rule-based jika Groq AI tidak tersedia/gagal.
 * 
 * @param {string} title - Judul berita
 * @param {string} category - Kategori/sumber berita
 * @returns {Promise<Object>} - Result analisis
 */
export async function analyzeHeadlineAsync(title = '', category = '') {
  const aiResult = await analyzeHeadlineWithGroq(title, category);
  if (aiResult) {
    return aiResult;
  }
  return analyzeInvestingHeadline(title, category);
}
