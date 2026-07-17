"""
MODULE 5: Crime Prediction (Time Series)
Implements ARIMA / SARIMA for predicting future crime counts per region/grid.
"""
import logging
import numpy as np
import pandas as pd
from statsmodels.tsa.statespace.sarimax import SARIMAX
import warnings
from pathlib import Path
import sys
import pickle

sys.path.append(str(Path(__file__).parent.parent))
from config import ARIMA_ORDER, SARIMA_SEASONAL_ORDER, PREDICTION_HORIZON_HOURS, MODEL_DIR

logger = logging.getLogger(__name__)

# Ignore statsmodels warnings for non-stationary data in convergence
warnings.filterwarnings("ignore")

class CrimePredictor:
    """
    Time-series forecasting model using SARIMA to predict future crime trends.
    """

    def __init__(self, order=ARIMA_ORDER, seasonal_order=SARIMA_SEASONAL_ORDER):
        self.order = order
        self.seasonal_order = seasonal_order
        self.models = {} # grid_cell -> fitted model
        self.last_dates = {} # grid_cell -> last datetime observed
        self.forecasts = {} # grid_cell -> pre-computed forecasts
        
    def fit(self, ts_data_dict, verbose=False):
        """
        Train SARIMA models for each region time-series.
        ts_data_dict: dict of {area_id: DataFrame with date index and 'crime_count' column}
        """
        total = len(ts_data_dict)
        logger.info(f"Training prediction models for {total} areas...")
        
        completed = 0
        skipped = 0
        failed = 0
        
        for area_id, ts in ts_data_dict.items():
            if len(ts) < 14:
                skipped += 1
                continue
                
            try:
                history = ts["crime_count"].values
                model = SARIMAX(history, order=self.order, seasonal_order=self.seasonal_order, enforce_stationarity=False, enforce_invertibility=False)
                fitted_model = model.fit(disp=False)
                
                self.models[area_id] = fitted_model
                self.last_dates[area_id] = ts.index[-1]
                completed += 1
            except Exception as e:
                failed += 1
                
            # Print progress every 50 models
            done = completed + skipped + failed
            if verbose and done % 50 == 0:
                pct = round(100 * done / total, 1)
                print(f"      ⏳ Progress: {done}/{total} ({pct}%) — {completed} trained, {skipped} skipped, {failed} failed", flush=True)
                
        logger.info(f"Done: {completed} trained, {skipped} skipped, {failed} failed.")
        
    def predict(self, area_id, periods=PREDICTION_HORIZON_HOURS):
        """
        Predict future crime counts for a specific area.
        """
        if area_id not in self.models:
            # Check pre-computed forecasts
            if area_id in self.forecasts:
                return self.forecasts[area_id]
            logger.warning(f"No trained model for area {area_id}")
            return None
            
        model = self.models[area_id]
        
        try:
            forecast = model.forecast(steps=periods)
            forecast = np.maximum(0, np.round(forecast)).astype(int)
            
            last_date = self.last_dates[area_id]
            future_dates = pd.date_range(start=last_date + pd.Timedelta(days=1), periods=periods, freq='D')
            
            predictions = []
            for dt, val in zip(future_dates, forecast):
               predictions.append({"date": str(dt.date()), "predicted_count": int(val)})
               
            return predictions
        except Exception as e:
            logger.error(f"Prediction failed for {area_id}: {e}")
            return None
            
    def calculate_metrics(self, ts_data_dict):
        """
        Calculates MAE, RMSE, and MAPE for the fitted models using in-sample predictions.
        (Note: For a true evaluation, a train/test split should be used, but since we are
        training on the full dataset for the API, we use in-sample fit metrics to show accuracy.)
        """
        from sklearn.metrics import mean_absolute_error, mean_squared_error
        import numpy as np
        
        all_y_true = []
        all_y_pred = []
        
        for area_id, model in self.models.items():
            if area_id not in ts_data_dict:
                continue
            
            # Predict in-sample
            # Skip the first few periods which might be unstable
            y_true = ts_data_dict[area_id]['crime_count'].values
            
            try:
                # Get in-sample predictions
                preds = model.predict()
                
                # Make sure lengths match (sometimes SARIMAX diffs drop first row)
                min_len = min(len(y_true), len(preds))
                if min_len > 7:
                    # Skip first 7 days of training as burn-in
                    all_y_true.extend(y_true[-min_len+7:])
                    all_y_pred.extend(preds[-min_len+7:])
            except Exception:
                continue
                
        if not all_y_true:
            return {"overall_mae": "N/A", "overall_rmse": "N/A", "overall_mape": "N/A"}
            
        # Ensure non-negative integers for predictions
        all_y_pred = np.maximum(0, np.round(all_y_pred)).astype(int)
        
        mae = mean_absolute_error(all_y_true, all_y_pred)
        rmse = np.sqrt(mean_squared_error(all_y_true, all_y_pred))
        
        # Calculate MAPE (avoid division by zero by replacing 0s with a small epsilon or ignoring)
        y_true_np = np.array(all_y_true)
        y_pred_np = np.array(all_y_pred)
        non_zero_mask = y_true_np > 0
        
        if np.sum(non_zero_mask) > 0:
            mape = np.mean(np.abs((y_true_np[non_zero_mask] - y_pred_np[non_zero_mask]) / y_true_np[non_zero_mask])) * 100
            mape = round(mape, 2)
        else:
            mape = "N/A"
            
        return {
            "overall_mae": round(mae, 3),
            "overall_rmse": round(rmse, 3),
            "overall_mape": mape
        }

    def predict_all(self, periods=7):
        """Predict for all trained areas."""
        results = {}
        for area_id in self.models.keys():
            results[area_id] = self.predict(area_id, periods)
        return results

    def save_models(self, filename="crime_predictions.json"):
        """
        Generate all 7-day forecasts and save as lightweight JSON.
        Avoids OOM from pickling 5000 heavy SARIMA objects.
        """
        import json
        
        logger.info(f"Generating 7-day forecasts for {len(self.models)} models...")
        
        all_forecasts = {}
        saved = 0
        for area_id in list(self.models.keys()):
            pred = self.predict(area_id, periods=7)
            if pred:
                all_forecasts[str(area_id)] = pred
                saved += 1
            
            # Free model memory after forecasting
            del self.models[area_id]
            
            if saved % 500 == 0 and saved > 0:
                print(f"      💾 Generated forecasts for {saved} areas...", flush=True)
        
        # Save forecasts as JSON (tiny file, ~2MB vs 4GB pickle)
        json_path = MODEL_DIR / filename
        with open(json_path, "w") as f:
            json.dump(all_forecasts, f)
        logger.info(f"Saved {saved} forecasts to {json_path}")
        
        # Store in memory for API access
        self.forecasts = all_forecasts
        self.models = {}  # Free memory
        
    def load_models(self, filename="crime_predictions.json"):
        """Load pre-computed forecasts from JSON."""
        import json
        
        path = MODEL_DIR / filename
        if not path.exists():
            raise FileNotFoundError(f"Predictions file {path} not found")
            
        with open(path, "r") as f:
            self.forecasts = json.load(f)
            
        logger.info(f"Loaded forecasts for {len(self.forecasts)} areas from {path}")

# ── Standalone execution ──
if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
    
    from preprocessing import CrimeDataPreprocessor
    from feature_engineering import FeatureEngineer
    
    p = CrimeDataPreprocessor()
    f = FeatureEngineer()
    
    df = p.load_fir_dataset(nrows=50000)
    df = p.preprocess(df)
    df = f.engineer_features(df)
    
    # Generate timeseries format (daily)
    ts_data = f.get_timeseries_data(df, freq="D", area_col="grid_cell")
    
    predictor = CrimePredictor()
    predictor.fit(ts_data)
    results = predictor.predict_all(periods=7) # 7 days horizon
    
    print("\n=== PREDICTIONS SAMPLE ===")
    sample_key = list(results.keys())[0] if results else None
    if sample_key:
        print(f"Predictions for Grid {sample_key}:")
        for r in results[sample_key]:
            print(f"  {r['date']}: {r['predicted_count']} crimes")
            
        predictor.save_models()
