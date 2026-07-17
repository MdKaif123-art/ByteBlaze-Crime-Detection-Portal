"""
MODULE 4: Hotspot Detection (Clustering)
Uses DBSCAN on valid geographical coordinates to identify crime hotspots.
Generates cluster geometries, boundaries, and associated metadata.
"""
import logging
import numpy as np
import pandas as pd
from sklearn.cluster import DBSCAN
from pathlib import Path
import sys

sys.path.append(str(Path(__file__).parent.parent))
from config import DBSCAN_EPS, DBSCAN_MIN_SAMPLES, DBSCAN_METRIC
from utils.geo_utils import compute_cluster_boundary

logger = logging.getLogger(__name__)


class HotspotDetector:
    """
    Detects crime hotspots using unsupervised spatial clustering.
    Defaults to DBSCAN using the Haversine metric.
    """

    def __init__(self, eps=DBSCAN_EPS, min_samples=DBSCAN_MIN_SAMPLES, metric=DBSCAN_METRIC):
        self.eps = eps
        self.min_samples = min_samples
        self.metric = metric
        
        # DBSCAN needs haversine eps in radians
        # Earth radius ~= 6371 km
        eps_radians = self.eps / 6371.0 if self.metric == 'haversine' else self.eps
        
        self.model = DBSCAN(eps=eps_radians, min_samples=self.min_samples, metric=self.metric, algorithm='ball_tree')
        self.cluster_data = None
        self._fitted = False

    def fit_predict(self, df):
        """
        Fit DBSCAN to coordinates and assign cluster labels.
        Only uses rows with valid (non-zero) coordinates.
        Returns original DataFrame updated with 'cluster_id'.
        """
        logger.info(f"Starting hotspot detection with {len(df)} records")
        
        # Initialize cluster_id to -1 (noise)
        df["cluster_id"] = -1
        
        # Filter valid coords
        valid_mask = (df["latitude"] != 0) & (df["longitude"] != 0)
        valid_df = df[valid_mask].copy()
        
        if len(valid_df) < self.min_samples:
            logger.warning(f"Not enough valid records ({len(valid_df)}) for clustering.")
            return df
            
        coords = np.radians(valid_df[["latitude", "longitude"]].values)
        
        # Fit model
        logger.info(f"Running DBSCAN clustering on {len(coords)} spatial points...")
        cluster_labels = self.model.fit_predict(coords)
        
        # Assign back to original dataframe using indices
        valid_df["cluster_id"] = cluster_labels
        df.loc[valid_mask, "cluster_id"] = valid_df["cluster_id"]
        
        n_clusters = len(set(cluster_labels)) - (1 if -1 in cluster_labels else 0)
        n_noise = list(cluster_labels).count(-1)
        logger.info(f"DBSCAN found {n_clusters} clusters and {n_noise} noise points.")
        
        self._fitted = True
        return df

    def generate_clusters_summary(self, df):
        """
        Generates aggregated cluster metadata and boundaries.
        Returns DataFrame of cluster attributes.
        """
        if not self._fitted:
            raise ValueError("Model must be fitted before generating summary.")
            
        cluster_df = df[df["cluster_id"] != -1].copy()
        if len(cluster_df) == 0:
            logger.warning("No clusters found to summarize.")
            self.cluster_data = pd.DataFrame()
            return self.cluster_data

        clusters = []
        for cluster_id, group in cluster_df.groupby("cluster_id"):
            lats = group["latitude"].values
            lons = group["longitude"].values
            
            centroid_lat = np.mean(lats)
            centroid_lon = np.mean(lons)
            
            # Crime type and legal category distribution
            crime_dist = group["crime_type"].value_counts().to_dict()
            
            if "legal_category" in group.columns:
                legal_category = group["legal_category"].mode()
                legal_category = legal_category.iloc[0] if not legal_category.empty else "GENERAL_IPC"
            else:
                legal_category = "GENERAL_IPC"
                
            if "season" in group.columns:
                season = group["season"].mode()
                season = season.iloc[0] if not season.empty else "UNKNOWN"
            else:
                season = "UNKNOWN"
            
            # Get predominant district
            district = group["district_name"].mode()
            district = district.iloc[0] if not district.empty else "Unknown"

            # Compute boundary polygon GeoJSON
            boundary = compute_cluster_boundary(lats, lons)
            
            stats = {
                "cluster_id": cluster_id,
                "centroid_lat": centroid_lat,
                "centroid_lng": centroid_lon,
                "crime_count": len(group),
                "avg_severity": group["severity"].mean() if "severity" in group.columns else 5.0,
                "max_severity": group["severity"].max() if "severity" in group.columns else 5.0,
                "district_name": district,
                "predominant_legal_category": legal_category,
                "season": season,
                "crime_type_distribution": crime_dist,
                "boundary": boundary,
                "bounding_box": {
                    "min_lat": float(np.min(lats)),
                    "max_lat": float(np.max(lats)),
                    "min_lng": float(np.min(lons)),
                    "max_lng": float(np.max(lons)),
                }
            }
            clusters.append(stats)
            
        self.cluster_data = pd.DataFrame(clusters)
        logger.info(f"Generated summary for {len(clusters)} clusters.")
        return self.cluster_data

# ── Standalone execution ──
if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
    
    from preprocessing import CrimeDataPreprocessor
    
    preprocessor = CrimeDataPreprocessor()
    df = preprocessor.load_fir_dataset(nrows=20000)
    df = preprocessor.preprocess(df)
    
    detector = HotspotDetector(eps=1.0, min_samples=3) # Relaxed for testing
    df = detector.fit_predict(df)
    clusters_summary = detector.generate_clusters_summary(df)
    
    if not clusters_summary.empty:
        print("\n=== CLUSTERS SUMMARY (Top 5) ===")
        print(clusters_summary[["cluster_id", "crime_count", "avg_severity", "district_name"]].head(5))
        
        output_path = Path(__file__).parent.parent / "data" / "clusters.csv"
        clusters_summary.to_csv(output_path, index=False)
        print(f"\nSaved clusters to: {output_path}")
