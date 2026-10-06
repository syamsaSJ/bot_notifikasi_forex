import { parseEconomicValue } from '../scraper/parser.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('SignalEngine');

/**
 * Daftar indikator ekonomi dimana angka LEBIH RENDAH justru BAGUS untuk USD.
 * Untuk indikator ini, logika dibalik:
 *   Actual < Forecast → USD Menguat (karena lebih rendah = lebih baik)
 *   Actual > Forecast → USD Melemah (karena lebih tinggi = lebih buruk)
 * 
 * Contoh: Unemployment Claims — semakin sedikit klaim pengangguran = ekonomi bagus.
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
 * Cek apakah indikator termasuk "inverted" (angka rendah = bagus).
 * @param {string} eventName - Nama event
 * @returns {boolean}
 */
export function isInvertedIndicator(eventName) {
  const lower = eventName.toLowerCase();
  return INVERTED_INDICATORS.some(inv => lower.includes(inv));
}

/**
 * Analisis sinyal XAU/USD berdasarkan data ekonomi.
 * 
 * Logika utama:
 * - Indikator Normal: Actual > Forecast → USD Menguat → SELL XAU/USD
 * - Indikator Normal: Actual < Forecast → USD Melemah → BUY XAU/USD
 * - Indikator Inverted: Logika dibalik
 * 
 * @param {Object} event - Event object dari scraper
 * @returns {Object} - Signal result
 */
export function analyzeSignal(event) {
  const { actual, forecast, previous, event: eventName } = event;

  // Parse nilai
  const actualVal = parseEconomicValue(actual);
  const forecastVal = parseEconomicValue(forecast);
  const previousVal = parseEconomicValue(previous);
  const isInverted = isInvertedIndicator(eventName);

  // 1. KASUS PRE-RELEASE (Data Actual belum dirilis)
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

      // Inverted: Forecast > Previous = Klaim naik = Ekonomi jelek = USD Melemah = BUY
      // Normal: Forecast > Previous = Ekonomi membaik = USD Menguat = SELL
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
      predictionText: 'Menunggu data rilis resmi dari Forex Factory.',
      analysis: forecastVal !== null
        ? `Jika Actual < ${forecast} → USD Melemah → BUY XAUUSD\nJika Actual > ${forecast} → USD Menguat → SELL XAUUSD`
        : 'Forecast dan Previous tidak lengkap, menunggu rilis data.',
      strength: 'N/A',
    };
  }

  // 2. KASUS POST-RELEASE (Data Actual sudah dirilis)
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

  // Bandingkan Actual vs Forecast
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
      analysis: 'Data sesuai ekspektasi. Tidak ada pergerakan signifikan yang diharapkan.',
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

/**
 * Fallback: analisis dengan Previous jika Forecast tidak tersedia.
 */
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
      analysis: 'Dibandingkan dengan Previous (Forecast tidak tersedia).',
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
      analysis: 'Dibandingkan dengan Previous (Forecast tidak tersedia).',
      strength: 'Sedang',
    };
  }
}

