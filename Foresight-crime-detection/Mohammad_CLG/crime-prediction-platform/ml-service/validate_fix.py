"""Quick validation - writes results to UTF-8 file."""
import sys
try:
    from pipeline.preprocessing import CrimeDataPreprocessor
    p = CrimeDataPreprocessor()
    df = p.load_fir_dataset(nrows=100)
    processed = p.preprocess(df)
    lines = [
        f"SUCCESS: Loaded {len(df)} rows, processed to {len(processed)} rows",
        f"Columns: {len(processed.columns)}",
        f"Districts: {processed['district_name'].nunique()}",
        f"Crime types: {processed['crime_type'].nunique()}",
        f"Severity range: {processed['severity'].min()} - {processed['severity'].max()}",
    ]
except Exception as e:
    lines = [f"FAILED: {type(e).__name__}: {e}"]

with open("validate_out.txt", "w", encoding="utf-8") as f:
    f.write("\n".join(lines))
