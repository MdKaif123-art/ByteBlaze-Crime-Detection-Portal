"""
MODULE 2: Data Preprocessing Pipeline
Handles the Karnataka FIR dataset with:
  - Multiple date format parsing (YYYY-MM-DD HH:mm:ss.SSS and DD/MM/YYYY)
  - Zero lat/lon geocoding using district coordinates
  - Missing value imputation
  - Duplicate removal
  - Feature extraction from timestamps
  - Label encoding for crime types
  - Numerical normalization
"""
import logging
import numpy as np
import pandas as pd
from sklearn.preprocessing import LabelEncoder, MinMaxScaler
from pathlib import Path
import sys
import re
import time
from geopy.geocoders import Nominatim
from geopy.exc import GeocoderTimedOut, GeocoderServiceError

sys.path.append(str(Path(__file__).parent.parent))
from config import (
    KARNATAKA_DISTRICT_COORDS,
    DISTRICT_COORDS,
    DISTRICT_TO_STATE,
    CRIME_SEVERITY_MAP,
    FIR_TYPE_DEFAULT_SEVERITY,
    FIR_DATASET_PATH,
    ACT_CLASSIFICATIONS,
    SEASONS,
    TAMIL_NADU_DISTRICTS,
    KARNATAKA_DISTRICTS,
    COLUMN_ALIASES,
)

logger = logging.getLogger(__name__)


class CrimeDataPreprocessor:
    """
    Preprocesses raw FIR/CCTNS crime data into ML-ready format.
    """

    def __init__(self):
        self.label_encoder = LabelEncoder()
        self.scaler = MinMaxScaler()
        self.crime_type_mapping = {}
        self._fitted = False
        self.geolocator = Nominatim(user_agent="karnataka_crime_platform_agent")
        self.geo_cache = {}

    def load_fir_dataset(self, path=None, nrows=None, chunk_size=None):
        """
        Load the FIR Details CSV dataset.
        Supports chunked loading for the 862MB file.
        """
        path = path or FIR_DATASET_PATH
        logger.info(f"Loading FIR dataset from: {path}")

        read_kwargs = {
            "encoding": "utf-8",
            "on_bad_lines": "skip",
            "low_memory": False,
        }
        if nrows:
            read_kwargs["nrows"] = nrows

        if chunk_size:
            chunks = []
            for chunk in pd.read_csv(path, chunksize=chunk_size, **read_kwargs):
                processed = self._map_fir_columns(chunk)
                chunks.append(processed)
            df = pd.concat(chunks, ignore_index=True)
        else:
            raw = pd.read_csv(path, **read_kwargs)
            df = self._map_fir_columns(raw)

        logger.info(f"Loaded {len(df)} records")
        return df

    def _resolve_column(self, raw_df: pd.DataFrame, standard_name: str, default=None):
        """
        Resolve a standard internal column name from any state's CSV using COLUMN_ALIASES.
        Returns the Series if found, otherwise a default Series.
        """
        aliases = COLUMN_ALIASES.get(standard_name, [standard_name])
        for alias in aliases:
            if alias in raw_df.columns:
                return raw_df[alias]
        # Return default series
        if default is not None:
            return pd.Series(default, index=raw_df.index)
        return None

    def _map_fir_columns(self, raw_df):
        """Map FIR dataset columns to our standard schema — supports any Indian state CSV format."""
        self._current_index = raw_df.index  # Store for helper methods
        df = pd.DataFrame()

        # Generate unique crime_id from FIR_ID or index
        fir_id_col = self._resolve_column(raw_df, "FIR_ID")
        if fir_id_col is not None:
            df["crime_id"] = fir_id_col.astype(str)
        else:
            df["crime_id"] = [f"FIR_{i}" for i in range(len(raw_df))]

        # Location
        df["latitude"] = pd.to_numeric(self._resolve_column(raw_df, "Latitude", 0), errors="coerce").fillna(0)
        df["longitude"] = pd.to_numeric(self._resolve_column(raw_df, "Longitude", 0), errors="coerce").fillna(0)

        empty_str_series = pd.Series("", index=raw_df.index)

        # District info (for geocoding)
        df["district_name"] = self._resolve_column(raw_df, "District_Name", "").astype(str).str.strip()
        df["unit_name"] = self._resolve_column(raw_df, "UnitName", "").astype(str).str.strip()
        df["fir_no"] = self._resolve_column(raw_df, "FIR_ID", "").astype(str)

        # Temporal — parse multiple date formats
        df["offence_from_date"] = self._parse_datetime(self._resolve_column(raw_df, "Offence_From_Date"))
        df["offence_to_date"] = self._parse_datetime(self._resolve_column(raw_df, "Offence_To_Date"))
        df["fir_reg_datetime"] = self._parse_datetime(self._resolve_column(raw_df, "FIR_Reg_DateTime"))
        df["fir_date"] = self._parse_date_dmy(self._resolve_column(raw_df, "FIR_Date"))

        # Primary timestamp: prefer offence_from_date → fir_reg_datetime → fir_date
        df["timestamp"] = df["offence_from_date"].fillna(df["fir_reg_datetime"]).fillna(df["fir_date"])

        df["year"] = pd.to_numeric(self._resolve_column(raw_df, "Year", None), errors="coerce")
        df["month"] = pd.to_numeric(self._resolve_column(raw_df, "Month", None), errors="coerce")

        # Crime classification
        df["crime_group"] = self._resolve_column(raw_df, "CrimeGroup_Name", "").astype(str).str.strip()
        df["crime_head"] = self._resolve_column(raw_df, "CrimeHead_Name", "").astype(str).str.strip()
        df["crime_type"] = df["crime_group"]  # Use crime_group as primary type
        df["fir_type"] = self._resolve_column(raw_df, "FIR_Type", "").astype(str).str.strip()
        df["fir_stage"] = self._resolve_column(raw_df, "FIR_Stage", "").astype(str)
        df["complaint_mode"] = self._resolve_column(raw_df, "Complaint_Mode", "").astype(str)
        df["act_section"] = self._resolve_column(raw_df, "ActSection", "").astype(str)

        # Victim info
        zero_series = pd.Series(0, index=raw_df.index)
        for col, alias_key in [
            ("victim_count", "VICTIM_COUNT"),
            ("accused_count", "Accused_Count"),
            ("arrested_count", "Arrested_Count"),
        ]:
            df[col] = pd.to_numeric(self._resolve_column(raw_df, alias_key, 0), errors="coerce").fillna(0).astype(int)

        # Victim demographics (optional columns)
        for col, src in [("male_victims", "Male"), ("female_victims", "Female"),
                         ("boy_victims", "Boy"), ("girl_victims", "Girl")]:
            raw_val = raw_df.get(src, zero_series)
            df[col] = pd.to_numeric(raw_val, errors="coerce").fillna(0).astype(int)

        # Location details
        df["place_of_offence"] = self._resolve_column(raw_df, "Place_of_Offence", "").astype(str)
        df["beat_name"] = self._resolve_column(raw_df, "Beat_Name", "").astype(str)
        df["village_area_name"] = self._resolve_column(raw_df, "Village_Area_Name", "").astype(str)
        df["distance_from_ps"] = raw_df.get("Distance_from_PS_km", raw_df.get("Distance from PS", empty_str_series)).astype(str)
        df["io_name"] = raw_df.get("IOName", empty_str_series).astype(str)

        return df

    def _parse_datetime(self, series):
        """Parse various flexible datetime formats seamlessly (Indian/ISO)."""
        if series is None or not hasattr(series, 'index'):
            # Return index-aligned NaT series to prevent fillna alignment failures
            idx = getattr(self, '_current_index', pd.RangeIndex(0))
            return pd.Series(pd.NaT, index=idx, dtype="datetime64[ns]")
        return pd.to_datetime(series, errors="coerce", dayfirst=True)

    def _parse_date_dmy(self, series):
        """Parse DD/MM/YYYY format."""
        if series is None or not hasattr(series, 'index'):
            idx = getattr(self, '_current_index', pd.RangeIndex(0))
            return pd.Series(pd.NaT, index=idx, dtype="datetime64[ns]")
        return pd.to_datetime(series, errors="coerce", dayfirst=True)

    def preprocess(self, df):
        """
        Full preprocessing pipeline:
        1. Remove duplicates
        2. Handle missing values
        3. Geocode zero coordinates
        4. Derive severity
        5. Extract time features
        6. Encode crime types
        7. Normalize numerical features
        """
        logger.info(f"Starting preprocessing on {len(df)} records...")
        initial_count = len(df)

        # Step 1: Remove duplicates
        df = self._remove_duplicates(df)
        logger.info(f"After dedup: {len(df)} records (removed {initial_count - len(df)})")

        # Step 2: Handle missing timestamps
        df = self._handle_missing_values(df)

        # Step 3: Geocode zero coordinates using district names
        df = self._geocode_zero_coordinates(df)
        valid_coords = ((df["latitude"] != 0) & (df["longitude"] != 0)).sum()
        logger.info(f"Valid coordinates: {valid_coords}/{len(df)} ({100*valid_coords/len(df):.1f}%)")

        # Step 4: Derive severity from crime_group + fir_type
        df = self._derive_severity(df)

        # Step 4b: Parse specific Legal Categories (Problem Statement Logic)
        df = self._extract_legal_classifications(df)

        # Step 5: Extract time-based features (and Seasonal Behavioural logic)
        df = self._extract_time_features(df)

        # Step 6: Encode crime types
        df = self._encode_crime_types(df)

        # Step 7: Normalize numerical features
        df = self._normalize_features(df)

        df["processed"] = True
        logger.info(f"Preprocessing complete: {len(df)} records ready")
        return df

    def _remove_duplicates(self, df):
        """Remove exact duplicates based on crime_id only."""
        before = len(df)
        df = df.drop_duplicates(subset=["crime_id"], keep="first")
        logger.info(f"Removed {before - len(df)} duplicate records")
        return df.reset_index(drop=True)

    def _handle_missing_values(self, df):
        """Handle missing values in critical columns."""
        # Drop rows without timestamp
        before = len(df)
        df = df.dropna(subset=["timestamp"])
        logger.info(f"Dropped {before - len(df)} rows with missing timestamps")

        # Fill missing crime_type
        df["crime_type"] = df["crime_type"].fillna("UNKNOWN")
        df["crime_group"] = df["crime_group"].fillna("UNKNOWN")

        # Fill missing victim/accused counts with 0
        count_cols = ["victim_count", "male_victims", "female_victims",
                      "boy_victims", "girl_victims", "accused_count", "arrested_count"]
        for col in count_cols:
            if col in df.columns:
                df[col] = df[col].fillna(0)

        # Fill year/month from timestamp if missing
        df["year"] = df["year"].fillna(df["timestamp"].dt.year)
        df["month"] = df["month"].fillna(df["timestamp"].dt.month)

        return df

    def _geocode_zero_coordinates(self, df):
        """
        Uses Live OpenStreetMap API to translate Police Station 'UnitNames' into 
        exact Street-Level GPS coordinates for missing records.
        """
        zero_mask = (df["latitude"] == 0) | (df["longitude"] == 0)
        zero_count = zero_mask.sum()
        logger.info(f"Connecting to live OSM Geolocation API to patch {zero_count} missing coordinates...")

        # Find unique stations to avoid spamming the API
        unique_stations = df[zero_mask][["district_name", "unit_name"]].drop_duplicates()
        station_to_coords = {}

        for _, row in unique_stations.iterrows():
            district = row.get("district_name", "")
            unit = row.get("unit_name", "")

            clean_unit = str(unit).replace(" PS", " Police Station").title()
            district_norm = str(district).strip()
            # Smart state detection: look up the district in our universal state map
            state = DISTRICT_TO_STATE.get(district_norm, None)
            region = state  # Will be None for unknown districts → falls back to just India

            query_string = (
                f"{clean_unit}, {district_norm}, {region}, India"
                if region
                else f"{clean_unit}, {district_norm}, India"
            )

            if query_string in self.geo_cache:
                station_to_coords[(district, unit)] = self.geo_cache[query_string]
                continue

            try:
                location = self.geolocator.geocode(query_string, timeout=5)
                if location:
                    coords = (location.latitude, location.longitude)
                    self.geo_cache[query_string] = coords
                    station_to_coords[(district, unit)] = coords
                    time.sleep(1)  # Respect Free OSM API rate limit
                else:
                    station_to_coords[(district, unit)] = None
            except Exception:
                station_to_coords[(district, unit)] = None
                time.sleep(1)

        geocoded_api_count = 0
        fallback_count = 0

        for idx in df[zero_mask].index:
            district = df.loc[idx, "district_name"]
            unit = df.loc[idx, "unit_name"]
            
            api_coords = station_to_coords.get((district, unit))
            if api_coords:
                # Add tiny 200m street jitter to avoid stacking on the exact police station roof
                df.loc[idx, "latitude"] = api_coords[0] + np.random.uniform(-0.002, 0.002)
                df.loc[idx, "longitude"] = api_coords[1] + np.random.uniform(-0.002, 0.002)
                geocoded_api_count += 1
            else:
                # Fallback to District Center — works for any Indian district via universal DISTRICT_COORDS
                coords = DISTRICT_COORDS.get(district) or KARNATAKA_DISTRICT_COORDS.get(district)
                if coords:
                    df.loc[idx, "latitude"] = coords[0] + np.random.uniform(-0.02, 0.02)
                    df.loc[idx, "longitude"] = coords[1] + np.random.uniform(-0.02, 0.02)
                    fallback_count += 1

        df["coordinates_geocoded"] = zero_mask
        logger.info(f"Geocoded {geocoded_api_count} records perfectly via API. {fallback_count} relied on District Center Fallbacks.")

        return df

    def _derive_severity(self, df):
        """Derive severity score (1-10) from crime_group and fir_type."""
        df["severity"] = df.apply(self._get_severity_score, axis=1)
        logger.info(f"Severity distribution:\n{df['severity'].describe()}")
        return df

    def _get_severity_score(self, row):
        """Get severity score for a single record."""
        crime = row.get("crime_group", "").strip().upper()
        fir_type = row.get("fir_type", "Other")

        # First check exact match in severity map
        for key, score in CRIME_SEVERITY_MAP.items():
            if key.upper() == crime:
                return score

        # Partial match
        for key, score in CRIME_SEVERITY_MAP.items():
            if key.upper() in crime or crime in key.upper():
                return score

        # Fall back to FIR type default
        return FIR_TYPE_DEFAULT_SEVERITY.get(fir_type, 5)

    def _extract_time_features(self, df):
        """Extract temporal features from timestamp and apply Behavioral Seasons."""
        ts = df["timestamp"]
        df["hour"] = ts.dt.hour
        df["day_of_week"] = ts.dt.dayofweek  # 0=Monday
        df["month"] = ts.dt.month            # Needed for season logic
        df["day_of_month"] = ts.dt.day
        df["week_of_year"] = ts.dt.isocalendar().week.astype(int)
        df["is_weekend"] = (df["day_of_week"] >= 5).astype(int)
        df["is_night"] = ((df["hour"] >= 20) | (df["hour"] <= 5)).astype(int)

        # Behavioral Seasonal Mapping
        df["season"] = df["month"].map(SEASONS)

        # Time period bins
        df["time_period"] = pd.cut(
            df["hour"],
            bins=[-1, 5, 11, 16, 20, 24],
            labels=["night", "morning", "afternoon", "evening", "late_night"]
        )

        logger.info("Extracted time features and behavioural seasons")
        return df

    def _extract_legal_classifications(self, df):
        """Parse raw ActSection text to identify specific project problem statement categories."""
        df["legal_category"] = "UNKNOWN"
        
        # Function to scan the text for mentioned acts
        def categorize_act(text):
            text = str(text).upper()
            if text == "NAN" or text == "NONE": return "UNKNOWN"
            
            for category, codes in ACT_CLASSIFICATIONS.items():
                for code in codes:
                    # Look for exact word matches like " 302 " or "IPC 302"
                    pattern = rf"\b{code}\b"
                    if re.search(pattern, text):
                        return category
            return "GENERAL_IPC"

        df["legal_category"] = df["act_section"].apply(categorize_act)
        return df

    def _encode_crime_types(self, df):
        """Label encode crime types — assigns back to full df by index."""
        # Fill NaN before encoding to avoid index mismatches
        df["crime_type"] = df["crime_type"].fillna("UNKNOWN").astype(str)
        self.label_encoder.fit(df["crime_type"])
        # Transform the full column (no subset), so index stays perfectly aligned
        df["crime_type_encoded"] = self.label_encoder.transform(df["crime_type"])

        # Save mapping
        self.crime_type_mapping = dict(
            zip(self.label_encoder.classes_, self.label_encoder.transform(self.label_encoder.classes_))
        )
        logger.info(f"Encoded {len(self.crime_type_mapping)} unique crime types")
        self._fitted = True
        return df

    def _normalize_features(self, df):
        """Normalize numerical features to [0, 1] range."""
        numerical_cols = ["severity", "victim_count", "accused_count", "arrested_count"]
        existing_cols = [c for c in numerical_cols if c in df.columns]

        if existing_cols:
            df[[f"{c}_normalized" for c in existing_cols]] = self.scaler.fit_transform(
                df[existing_cols].fillna(0)
            )
            logger.info(f"Normalized columns: {existing_cols}")

        return df

    def get_spatial_subset(self, df):
        """Return only records with valid (non-zero) coordinates."""
        mask = (df["latitude"] != 0) & (df["longitude"] != 0)
        subset = df[mask].copy()
        logger.info(f"Spatial subset: {len(subset)}/{len(df)} records with valid coordinates")
        return subset

    def get_summary(self, df):
        """Generate a summary of the preprocessed data."""
        return {
            "total_records": len(df),
            "valid_coordinates": int(((df["latitude"] != 0) & (df["longitude"] != 0)).sum()),
            "geocoded_records": int(df.get("coordinates_geocoded", pd.Series(dtype=bool)).sum()),
            "date_range": {
                "start": str(df["timestamp"].min()),
                "end": str(df["timestamp"].max()),
            },
            "crime_types": int(df["crime_type"].nunique()),
            "districts": sorted(df["district_name"].dropna().unique().tolist()),
            "severity_stats": {
                "mean": float(df["severity"].mean()),
                "median": float(df["severity"].median()),
                "max": float(df["severity"].max()),
            },
            "fir_type_distribution": df["fir_type"].value_counts().to_dict(),
            "top_crime_types": df["crime_type"].value_counts().head(10).to_dict(),
        }


# ── Standalone execution ──
if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

    preprocessor = CrimeDataPreprocessor()

    # Load first 10K rows for testing
    print("Loading FIR dataset (first 10,000 rows)...")
    df = preprocessor.load_fir_dataset(nrows=10000)
    print(f"Loaded: {len(df)} rows, Columns: {list(df.columns)}")

    # Preprocess
    df = preprocessor.preprocess(df)

    # Summary
    summary = preprocessor.get_summary(df)
    print("\n=== PREPROCESSING SUMMARY ===")
    for key, val in summary.items():
        print(f"  {key}: {val}")

    # Save processed data
    output_path = Path(__file__).parent.parent / "data" / "processed_crimes.csv"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(output_path, index=False)
    print(f"\nSaved processed data to: {output_path}")
