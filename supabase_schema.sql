-- =========================================================================
-- SQL Schema Setup untuk Database Supabase (XAU/USD Gold News & Calendar)
-- Jalankan query ini di menu: Supabase Dashboard -> SQL Editor -> Run
-- =========================================================================

-- 1. Tabel Kalender Ekonomi (Economic Calendar)
CREATE TABLE IF NOT EXISTS public.economic_calendar (
    id TEXT PRIMARY KEY,
    source TEXT DEFAULT 'Forex Factory',
    event TEXT NOT NULL,
    title TEXT NOT NULL,
    currency TEXT DEFAULT 'USD',
    impact TEXT DEFAULT 'medium',
    date DATE NOT NULL,
    time TEXT,
    time_wib TEXT,
    timestamp BIGINT NOT NULL,
    actual TEXT DEFAULT '-',
    forecast TEXT DEFAULT '-',
    previous TEXT DEFAULT '-',
    actual_value NUMERIC,
    forecast_value NUMERIC,
    previous_value NUMERIC,
    signal JSONB,
    analysis JSONB,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexing untuk kecepatan query berdasarkan tanggal & timestamp
CREATE INDEX IF NOT EXISTS idx_calendar_timestamp ON public.economic_calendar (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_calendar_date ON public.economic_calendar (date);

-- 2. Tabel Headline Berita Pasar (News Headlines)
CREATE TABLE IF NOT EXISTS public.news_headlines (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    title TEXT NOT NULL,
    link TEXT,
    pub_date TEXT,
    date DATE NOT NULL,
    time_wib TEXT,
    timestamp BIGINT NOT NULL,
    category TEXT DEFAULT 'Market News',
    signal JSONB,
    analysis JSONB,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexing untuk kecepatan query berita terbaru
CREATE INDEX IF NOT EXISTS idx_news_timestamp ON public.news_headlines (timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_news_date ON public.news_headlines (date);

-- 3. Row Level Security (RLS) - Izinkan Publik membaca & menulis (atau sesuai anon key)
ALTER TABLE public.economic_calendar ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.news_headlines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access calendar" ON public.economic_calendar FOR SELECT USING (true);
CREATE POLICY "Allow public insert/update calendar" ON public.economic_calendar FOR ALL USING (true);

CREATE POLICY "Allow public read access news" ON public.news_headlines FOR SELECT USING (true);
CREATE POLICY "Allow public insert/update news" ON public.news_headlines FOR ALL USING (true);
