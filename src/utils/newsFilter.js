/**
 * Filter berita agar hanya mengambil headline yang 100% RELEVAN dengan XAU/USD (Gold),
 * USD, Federal Reserve, Indikator Ekonomi AS, serta faktor Makro / Geopolitik.
 * 
 * Mengeliminasi berita sampah seperti Crypto (Bitcoin/Altcoin), Saham Korporasi (Apple/Tesla),
 * Pasangan Mata Uang Cross Non-USD, serta topik hiburan/olahraga (e.g. Yahoo Sports, YouTube Gold, Olympic Gold).
 */

// Frasa Non-Finansial yang mengandung kata "gold" / "golden" tetapi BUKAN instrumen emas pasar keuangan.
const NON_FINANCIAL_GOLD_PHRASES = [
  'youtube gold',
  'gold medal', 'gold medals', 'gold medalist', 'gold medalists',
  'gold cup', 'gold award', 'gold awards', 'gold star', 'gold glove',
  'golden globe', 'golden globes', 'golden state', 'golden knights', 'golden eagles', 'golden bears',
  'golden gophers', 'golden flashes', 'golden hurricanes', "fool's gold", 'gold rush', 'gold coast',
  'gold status', 'gold edition', 'gold album', 'gold record', 'gold card', 'gold membership'
];

// Kata kunci Wajib / Relevan (Salah satu harus ada)
const POSITIVE_KEYWORDS = [
  // Emas & Logam Mulia (Finansial & Pasar)
  'gold', 'xau', 'xauusd', 'xau/usd', 'precious metal', 'precious metals', 'bullion', 'silver', 'spot gold', 'gold price', 'gold prices', 'gold futures',

  // Dolar AS & Indeks Dolar
  'usd', 'us dollar', 'dollar', 'greenback', 'dxy', 'us dollar index',

  // Bank Sentral & Federal Reserve
  'fed', 'fomc', 'powell', 'federal reserve', 'rate cut', 'rate cuts', 'rate hike', 'rate hikes',
  'interest rate', 'interest rates', 'monetary policy', 'central bank', 'central banks', 'dovish', 'hawkish',
  'treasury', 'treasuries', 'bond yield', 'bond yields', 'yields', 't-note',

  // Indikator Ekonomi Makro AS
  'cpi', 'pce', 'core pce', 'nfp', 'nonfarm', 'non-farm', 'payrolls', 'unemployment', 'jobless',
  'gdp', 'pmi', 'ppi', 'retail sales', 'inflation', 'consumer sentiment',
  'durable goods', 'trade balance', 'fomc minutes', 'beige book',

  // Faktor Makro & Geopolitik Utama Dampak Emas
  'geopolitic', 'geopolitical', 'war', 'middle east', 'conflict', 'sanction', 'sanctions',
  'tariff', 'tariffs', 'recession', 'safe haven', 'safe-haven', 'stagflation',
  'crude oil', 'oil price', 'oil prices'
];

// Kata kunci Sampah / Tidak Relevan (Kripto, Saham Korporasi, Olahraga, Hiburan)
const NEGATIVE_KEYWORDS = [
  // Media & Kanal Olahraga / Hiburan
  'sports', 'yahoo sports', 'espn', 'bleacher report', 'cbs sports', 'fox sports', 'sky sports', 'sportsnet',
  'football', 'soccer', 'nba', 'nfl', 'mlb', 'nhl', 'ncaa', 'nascar', 'pga tour', 'premier league',
  'champions league', 'world cup', 'olympics', 'olympic', 'basketball', 'baseball', 'tennis', 'golf tour',
  'movie', 'actor', 'actress', 'hollywood', 'magazine', 'adidas', 'sneakers', 'statue', 'tip-off',

  // Kripto & Web3
  'bitcoin', 'btc', 'ethereum', 'eth', 'crypto', 'cryptocurrency', 'memecoin',
  'doge', 'dogecoin', 'solana', 'binance', 'coinbase', 'nft', 'airdrop', 'altcoin',
  'shiba', 'pepe', 'cardano', 'ripple', 'xrp', 'longs are liquidated', 'short liquidation',

  // Saham individu & korporasi non-makro
  'tesla', 'apple', 'nvidia', 'microsoft', 'amazon', 'meta', 'alphabet', 'google',
  'netflix', 'intel', 'amd', 'boeing', 'earnings report', 'q1 earnings', 'q2 earnings',
  'q3 earnings', 'q4 earnings', 'price target',

  // Cross currency non-USD yang tidak mempengaruhi XAU/USD
  'eur/jpy', 'gbp/jpy', 'aud/nzd', 'eur/gbp', 'gbp/aud', 'chf/jpy'
];

function createKeywordRegex(kw) {
  const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const startBoundary = /^\w/.test(kw) ? '\\b' : '';
  const endBoundary = /\w$/.test(kw) ? '\\b' : '';
  return new RegExp(`${startBoundary}${escaped}${endBoundary}`, 'i');
}

const POSITIVE_REGEXES = POSITIVE_KEYWORDS.map(createKeywordRegex);
const NEGATIVE_REGEXES = NEGATIVE_KEYWORDS.map(createKeywordRegex);
const NON_FINANCIAL_REGEXES = NON_FINANCIAL_GOLD_PHRASES.map(createKeywordRegex);

// Term eksplisit instrumen keuangan emas (untuk lolos kecualian jika ada nama korporasi/kripto)
const EXPLICIT_FINANCIAL_GOLD_REGEX = /\b(xau|xauusd|xau\/usd|spot gold|gold price|gold prices|gold futures|gold bullion|gold rally|gold slump|gold plunges|gold spikes|gold drops|gold gains)\b/i;

/**
 * Memeriksa apakah judul berita atau deskripsi relevan dengan XAU/USD.
 * @param {string} title - Judul berita
 * @param {string} description - Deskripsi/konten ringkas berita (opsional)
 * @returns {boolean} - true jika relevan, false jika berita sampah/irrelevant
 */
export function isRelevantToXAUUSD(title = '', description = '') {
  if (!title) return false;
  const rawText = `${title} ${description}`;

  // 1. Hapus frasa non-finansial seperti "youtube gold", "gold medal", "yahoo sports", dll
  let cleanText = rawText;
  NON_FINANCIAL_REGEXES.forEach(re => {
    cleanText = cleanText.replace(re, ' ');
  });

  // 2. Cek apakah mengandung kata kunci negatif (Olahraga, Kripto, Saham Korporasi)
  const hasNegative = NEGATIVE_REGEXES.some(re => re.test(cleanText));
  if (hasNegative) {
    // Hanya boleh lolos jika secara eksplisit menyebut instrumen finansial emas (xauusd, gold price, spot gold, dll)
    const hasExplicitFinancialGold = EXPLICIT_FINANCIAL_GOLD_REGEX.test(cleanText);
    if (!hasExplicitFinancialGold) {
      return false; // Eliminasi berita olahraga/sampah
    }
  }

  // 3. Cek apakah mengandung setidaknya satu kata kunci positif relevan makro/USD/Gold
  const hasPositive = POSITIVE_REGEXES.some(re => re.test(cleanText));
  return hasPositive;
}
