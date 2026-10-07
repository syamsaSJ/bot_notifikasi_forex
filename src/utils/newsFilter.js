/**
 * Filter berita agar hanya mengambil headline yang 100% RELEVAN dengan XAU/USD (Gold),
 * USD, Federal Reserve, Indikator Ekonomi AS, serta faktor Makro / Geopolitik.
 * 
 * Mengeliminasi berita sampah seperti Crypto (Bitcoin/Altcoin), Saham Korporasi (Apple/Tesla),
 * Pasangan Mata Uang Cross Non-USD, serta topik hiburan/olahraga.
 */

// Kata kunci Wajib / Relevan (Salah satu harus ada)
const POSITIVE_KEYWORDS = [
  // Emas & Logam Mulia
  'gold', 'xau', 'xauusd', 'precious metal', 'bullion', 'silver',

  // Dolar AS & Indeks Dolar
  'usd', 'us dollar', 'dollar', 'greenback', 'dxy',

  // Bank Sentral & Federal Reserve
  'fed', 'fomc', 'powell', 'federal reserve', 'rate cut', 'rate hike',
  'interest rate', 'monetary policy', 'central bank', 'dovish', 'hawkish',
  'treasury', 'treasuries', 'bond yield', 'yields', 't-note',

  // Indikator Ekonomi Makro AS
  'cpi', 'nfp', 'nonfarm', 'non-farm', 'payrolls', 'unemployment', 'jobless',
  'gdp', 'pmi', 'ppi', 'retail sales', 'inflation', 'consumer sentiment',
  'durable goods', 'trade balance', 'fomc minutes', 'beige book',

  // Faktor Makro & Geopolitik Utama Dampak Emas
  'geopolitic', 'war', 'middle east', 'conflict', 'sanction', 'sanctions',
  'tariff', 'tariffs', 'recession', 'safe haven', 'safe-haven', 'stagflation',
  'crude oil', 'oil price'
];

// Kata kunci Sampah / Tidak Relevan (Jika ada & tidak sebut emas/USD/Fed, buang)
const NEGATIVE_KEYWORDS = [
  // Kripto & Web3
  'bitcoin', 'btc', 'ethereum', 'eth', 'crypto', 'cryptocurrency', 'memecoin',
  'doge', 'dogecoin', 'solana', 'binance', 'coinbase', 'nft', 'airdrop', 'altcoin',
  'shiba', 'pepe', 'cardano', 'ripple', 'xrp', 'longs are liquidated', 'short liquidation',

  // Saham individu & korporasi non-makro
  'tesla', 'apple', 'nvidia', 'microsoft', 'amazon', 'meta', 'alphabet', 'google',
  'netflix', 'intel', 'amd', 'boeing', 'earnings report', 'q1 earnings', 'q2 earnings',
  'q3 earnings', 'q4 earnings', 'price target',

  // Cross currency non-USD yang tidak mempengaruhi XAU/USD
  'eur/jpy', 'gbp/jpy', 'aud/nzd', 'eur/gbp', 'gbp/aud', 'chf/jpy',

  // Hiburan / Olahraga / Penghargaan Non-Finansial
  'football', 'soccer', 'nba', 'nfl', 'movie', 'actor', 'actress', 'hollywood',
  'gold medal', 'gold award', 'gold star', 'youtube gold', 'magazine'
];

// Escape special regex characters in keywords
function createKeywordRegex(kw) {
  const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // If keyword contains non-word chars (like eur/jpy, xau/usd, safe-haven), don't wrap with \b on boundary
  const startBoundary = /^\w/.test(kw) ? '\\b' : '';
  const endBoundary = /\w$/.test(kw) ? '\\b' : '';
  return new RegExp(`${startBoundary}${escaped}${endBoundary}`, 'i');
}

const POSITIVE_REGEXES = POSITIVE_KEYWORDS.map(createKeywordRegex);
const NEGATIVE_REGEXES = NEGATIVE_KEYWORDS.map(createKeywordRegex);

/**
 * Memeriksa apakah judul berita atau deskripsi relevan dengan XAU/USD.
 * @param {string} title - Judul berita
 * @param {string} description - Deskripsi/konten ringkas berita (opsional)
 * @returns {boolean} - true jika relevan, false jika berita sampah/irrelevant
 */
export function isRelevantToXAUUSD(title = '', description = '') {
  if (!title) return false;
  const text = `${title} ${description}`;

  // 1. Cek apakah mengandung kata kunci negatif (Kripto, Saham Individu, dll)
  const hasNegative = NEGATIVE_REGEXES.some(re => re.test(text));
  if (hasNegative) {
    // Kecuali jika berita tersebut SECARA EKSPLISIT membahas dampaknya pada Gold / XAU
    const hasExplicitGold = /\b(gold|xau|xauusd|bullion)\b/i.test(text);
    if (!hasExplicitGold) {
      return false; // Eliminasi berita sampah
    }
  }

  // 2. Cek apakah mengandung setidaknya satu kata kunci positif relevan makro/USD/Gold
  const hasPositive = POSITIVE_REGEXES.some(re => re.test(text));
  return hasPositive;
}
