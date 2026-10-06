# 🤖 Bot XAU/USD Signal — Forex Factory

Sistem notifikasi otomatis berita ekonomi high-impact USD dari Forex Factory Calendar, beserta analisis korelasi USD vs XAU/USD dan rekomendasi sinyal **BUY / SELL**.

## ✨ Fitur

- 📰 Scraping otomatis berita high & medium impact USD dari Forex Factory
- 🧠 Analisis korelasi USD vs XAU/USD (Pre-release & Post-release)
- 🖼️ Notifikasi berupa **Gambar Card Elegan** (mirip UI aplikasi / screenshot client)
- 📨 Notifikasi via Telegram Bot API (`sendPhoto`)
- ⏰ Jadwal: Senin-Jumat, 07:00-23:00 WIB
- 🔄 Support indikator inverted (Unemployment Claims, dll)


## 🚀 Quick Start

### 1. Setup Telegram Bot

1. Buka Telegram, cari **@BotFather**
2. Kirim `/newbot`, ikuti instruksi
3. Catat **Bot Token** yang diberikan
4. Buat channel/group, tambahkan bot sebagai admin
5. Dapatkan **Chat ID**:
   - Kirim pesan ke bot
   - Buka: `https://api.telegram.org/bot<TOKEN>/getUpdates`
   - Cari `"chat":{"id": xxxxx}` — itulah Chat ID

### 2. Konfigurasi

```bash
# Copy file environment
cp .env.example .env

# Edit .env dengan token dan chat ID
```

Isi file `.env`:
```env
TELEGRAM_BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz
TELEGRAM_CHAT_ID=-1001234567890
TIMEZONE=Asia/Jakarta
CRON_EXPRESSION=0 0-16 * * 1-5
LOG_LEVEL=info
NODE_ENV=production
```

### 3. Install & Jalankan

```bash
# Install dependencies
npm install

# Jalankan bot
npm start
```

### 4. Perintah Bot Telegram

| Perintah | Fungsi |
|----------|--------|
| `/start` | Welcome message & daftar perintah |
| `/check` | Cek berita high-impact sekarang (manual) |
| `/today` | Lihat jadwal semua berita hari ini |
| `/status` | Status bot (uptime, next check, dll) |
| `/help` | Bantuan |

## 📦 Struktur Proyek

```
├── src/
│   ├── index.js                # Entry point
│   ├── scraper/
│   │   ├── forexFactory.js     # Scraper Forex Factory
│   │   └── parser.js           # HTML parser & economic value parser
│   ├── engine/
│   │   └── signalEngine.js     # Logic engine (Actual vs Forecast)
│   ├── bot/
│   │   └── telegram.js         # Telegram Bot API
│   ├── formatter/
│   │   └── messageFormatter.js # Format pesan notifikasi
│   ├── scheduler/
│   │   └── cronJob.js          # Cron scheduler
│   └── utils/
│       ├── config.js           # Environment config
│       └── logger.js           # Logging
├── test/
│   └── test-parser.js          # Unit tests
├── .env.example
├── package.json
├── railway.json                # Railway deployment
└── Procfile
```

## 🧠 Logika Analisis

```
Indikator Normal (NFP, CPI, GDP, dll):
  Actual > Forecast → USD Menguat → SELL XAU/USD
  Actual < Forecast → USD Melemah → BUY XAU/USD

Indikator Inverted (Unemployment Claims, dll):
  Actual < Forecast → USD Menguat → SELL XAU/USD
  Actual > Forecast → USD Melemah → BUY XAU/USD
```

## 🚂 Deploy ke Railway (Gratis)

1. Push code ke GitHub
2. Buka [railway.app](https://railway.app), login via GitHub
3. "New Project" → "Deploy from GitHub repo"
4. Set environment variables di Railway dashboard
5. Deploy otomatis!

## ⚠️ Disclaimer

> Sinyal yang dihasilkan bersifat **Analisis Fundamental Dasar** — hanya berdasarkan perbandingan Actual vs Forecast. Bukan financial advice. Gunakan sebagai referensi tambahan.
