import pandas as pd
from pipeline.preprocessing import CrimeDataPreprocessor
import time

def test_load():
    preprocessor = CrimeDataPreprocessor()
    start = time.time()
    df = preprocessor.load_fir_dataset(nrows=50000)
    print(f"Loaded {len(df)} rows.")
    print(f"Time Taken: {time.time() - start}s")
    
if __name__ == "__main__":
    test_load()
