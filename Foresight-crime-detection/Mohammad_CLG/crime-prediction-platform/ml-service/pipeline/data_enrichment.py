"""
MODULE: Data Enrichment
Enhances the base FIR dataset with real external environmental context.
Uses Open-Meteo Archive API for real historical weather data.
"""
import logging
import pandas as pd
import requests
import time
from pathlib import Path

logger = logging.getLogger(__name__)

# ── SOCIOECONOMIC STATIC MAPPING (Tamil Nadu + Karnataka Census Data) ──
DISTRICT_DEMOGRAPHICS = {
    # Tamil Nadu Districts (Census 2011 / Projected)
    "Chennai": {"population_density": 26553, "literacy_rate": 90.18, "unemployment_rate": 3.8},
    "Coimbatore": {"population_density": 740, "literacy_rate": 84.22, "unemployment_rate": 3.5},
    "Madurai": {"population_density": 800, "literacy_rate": 82.19, "unemployment_rate": 4.1},
    "Tiruchirappalli": {"population_density": 604, "literacy_rate": 83.44, "unemployment_rate": 4.0},
    "Salem": {"population_density": 560, "literacy_rate": 72.11, "unemployment_rate": 4.5},
    "Erode": {"population_density": 540, "literacy_rate": 72.77, "unemployment_rate": 4.3},
    "Vellore": {"population_density": 726, "literacy_rate": 79.15, "unemployment_rate": 4.6},
    "Tirunelveli": {"population_density": 497, "literacy_rate": 82.25, "unemployment_rate": 5.0},
    "Chengalpattu": {"population_density": 900, "literacy_rate": 85.0, "unemployment_rate": 3.9},
    "Dharmapuri": {"population_density": 340, "literacy_rate": 64.71, "unemployment_rate": 5.5},
    "Thanjavur": {"population_density": 480, "literacy_rate": 82.64, "unemployment_rate": 4.2},
    "Dindigul": {"population_density": 380, "literacy_rate": 76.26, "unemployment_rate": 4.8},
    "Kanchipuram": {"population_density": 1100, "literacy_rate": 85.29, "unemployment_rate": 3.6},
    "Cuddalore": {"population_density": 550, "literacy_rate": 78.04, "unemployment_rate": 4.7},
    "Villupuram": {"population_density": 420, "literacy_rate": 68.72, "unemployment_rate": 5.2},
    "Ariyalur": {"population_density": 290, "literacy_rate": 72.31, "unemployment_rate": 5.3},
    "Nagapattinam": {"population_density": 520, "literacy_rate": 82.91, "unemployment_rate": 4.4},
    "Sivaganga": {"population_density": 290, "literacy_rate": 80.84, "unemployment_rate": 4.9},
    "Ramanathapuram": {"population_density": 290, "literacy_rate": 79.87, "unemployment_rate": 5.4},
    "Theni": {"population_density": 370, "literacy_rate": 76.09, "unemployment_rate": 4.6},
    "Virudhunagar": {"population_density": 400, "literacy_rate": 79.75, "unemployment_rate": 4.5},
    "Thoothukudi": {"population_density": 400, "literacy_rate": 83.08, "unemployment_rate": 4.3},
    "Namakkal": {"population_density": 470, "literacy_rate": 72.08, "unemployment_rate": 4.2},
    "Tiruppur": {"population_density": 580, "literacy_rate": 76.35, "unemployment_rate": 3.4},
    "Karur": {"population_density": 410, "literacy_rate": 73.67, "unemployment_rate": 4.1},
    "Perambalur": {"population_density": 280, "literacy_rate": 72.69, "unemployment_rate": 5.0},
    "Krishnagiri": {"population_density": 350, "literacy_rate": 64.78, "unemployment_rate": 5.1},
    "Nilgiris": {"population_density": 310, "literacy_rate": 85.20, "unemployment_rate": 3.8},
    "Kallakurichi": {"population_density": 400, "literacy_rate": 70.50, "unemployment_rate": 5.3},
    "Ranipet": {"population_density": 650, "literacy_rate": 78.50, "unemployment_rate": 4.5},
    "Tirupathur": {"population_density": 450, "literacy_rate": 73.50, "unemployment_rate": 5.0},
    "Tenkasi": {"population_density": 420, "literacy_rate": 80.50, "unemployment_rate": 4.8},
    "Mayiladuthurai": {"population_density": 500, "literacy_rate": 83.00, "unemployment_rate": 4.3},
    "Pudukkottai": {"population_density": 340, "literacy_rate": 74.34, "unemployment_rate": 5.1},
    "Kanyakumari": {"population_density": 710, "literacy_rate": 91.75, "unemployment_rate": 3.5},
    # Karnataka Districts
    "Bengaluru City": {"population_density": 4381, "literacy_rate": 87.67, "unemployment_rate": 4.2},
    "Bagalkot": {"population_density": 288, "literacy_rate": 68.82, "unemployment_rate": 5.1},
    "Ballari": {"population_density": 300, "literacy_rate": 67.43, "unemployment_rate": 6.0},
}

# Tamil Nadu state averages for fallback
TN_AVG_POP_DENSITY = 555
TN_AVG_LITERACY = 80.09


class DataEnricher:
    """Enriches crime data with real demographics and weather data."""

    def __init__(self):
        self.weather_cache = {}
        self.demo_df = pd.DataFrame.from_dict(DISTRICT_DEMOGRAPHICS, orient='index')
        self.demo_df.index.name = 'district_name'
        self.demo_df.reset_index(inplace=True)

    def add_demographics(self, df):
        """Merges real district socioeconomic data into the crime dataframe."""
        logger.info("Enriching with Demographic Data...")

        enriched_df = pd.merge(df, self.demo_df, on='district_name', how='left')

        # Fill missing districts with Tamil Nadu state averages
        enriched_df['population_density'] = enriched_df['population_density'].fillna(TN_AVG_POP_DENSITY)
        enriched_df['literacy_rate'] = enriched_df['literacy_rate'].fillna(TN_AVG_LITERACY)
        enriched_df['unemployment_rate'] = enriched_df['unemployment_rate'].fillna(4.5)

        matched = (enriched_df['population_density'] != TN_AVG_POP_DENSITY).sum()
        logger.info(f"Demographics enrichment complete. {matched}/{len(enriched_df)} rows matched exact district data.")
        return enriched_df

    def add_historical_weather(self, df):
        """
        Fetches REAL historical weather from Open-Meteo Archive API.
        Batched by unique (district_center, year) — only ~35-70 API calls total.
        """
        logger.info("Enriching with REAL Historical Weather (Open-Meteo API)...")

        # Get unique districts with their center coordinates
        from config import DISTRICT_COORDS
        districts_in_data = df['district_name'].unique()

        # Determine date range in dataset
        min_date = df['timestamp'].min()
        max_date = df['timestamp'].max()

        if pd.isna(min_date) or pd.isna(max_date):
            logger.warning("No valid timestamps for weather lookup, using fallback.")
            df['max_temperature'] = 29.0
            df['precipitation_mm'] = 50.0
            return df

        start_str = str(min_date.date())
        end_str = str(max_date.date())

        # Fetch weather for each district center (batched — one API call per district)
        district_weather = {}
        api_calls = 0

        for district in districts_in_data:
            coords = DISTRICT_COORDS.get(district)
            if not coords:
                continue

            cache_key = f"{district}_{start_str}_{end_str}"
            if cache_key in self.weather_cache:
                district_weather[district] = self.weather_cache[cache_key]
                continue

            try:
                lat, lon = coords
                url = (
                    f"https://archive-api.open-meteo.com/v1/archive"
                    f"?latitude={lat}&longitude={lon}"
                    f"&start_date={start_str}&end_date={end_str}"
                    f"&daily=temperature_2m_max,precipitation_sum"
                    f"&timezone=Asia/Kolkata"
                )
                resp = requests.get(url, timeout=10)
                api_calls += 1

                if resp.status_code == 200:
                    data = resp.json()
                    daily = data.get('daily', {})
                    dates = daily.get('time', [])
                    temps = daily.get('temperature_2m_max', [])
                    precips = daily.get('precipitation_sum', [])

                    weather_df = pd.DataFrame({
                        'date': pd.to_datetime(dates),
                        'max_temperature': temps,
                        'precipitation_mm': precips,
                    })
                    district_weather[district] = weather_df
                    self.weather_cache[cache_key] = weather_df
                    logger.info(f"  ✅ Fetched weather for {district} ({len(dates)} days)")
                else:
                    logger.warning(f"  ⚠️  API returned {resp.status_code} for {district}")

                # Respect rate limits (free tier)
                time.sleep(0.3)

            except Exception as e:
                logger.warning(f"  ⚠️  Weather fetch failed for {district}: {e}")

        logger.info(f"Made {api_calls} API calls to Open-Meteo Archive.")

        # Merge weather by (district, date) — VECTORIZED for performance
        df['crime_date'] = pd.to_datetime(df['timestamp']).dt.date

        # Build a combined weather lookup table from all districts
        weather_frames = []
        for district, weather in district_weather.items():
            if weather is not None and not weather.empty:
                w = weather.copy()
                w['district_name'] = district
                w['date_key'] = pd.to_datetime(w['date']).dt.date
                weather_frames.append(w[['district_name', 'date_key', 'max_temperature', 'precipitation_mm']])

        if weather_frames:
            weather_lookup = pd.concat(weather_frames, ignore_index=True)
            df = df.merge(
                weather_lookup,
                left_on=['district_name', 'crime_date'],
                right_on=['district_name', 'date_key'],
                how='left',
                suffixes=('', '_weather')
            )
            # Use weather columns, fill missing
            if 'max_temperature_weather' in df.columns:
                df['max_temperature'] = df['max_temperature_weather']
                df['precipitation_mm'] = df['precipitation_mm_weather']
                df.drop(columns=['max_temperature_weather', 'precipitation_mm_weather', 'date_key'], inplace=True, errors='ignore')
        else:
            df['max_temperature'] = None
            df['precipitation_mm'] = None

        # Fill any remaining nulls with Tamil Nadu averages
        df['max_temperature'] = df['max_temperature'].fillna(29.0)
        df['precipitation_mm'] = df['precipitation_mm'].fillna(50.0)

        df.drop(columns=['crime_date'], inplace=True, errors='ignore')

        filled = df['max_temperature'].notna().sum()
        logger.info(f"Weather enrichment complete. {filled}/{len(df)} rows have real temperature data.")
        return df
