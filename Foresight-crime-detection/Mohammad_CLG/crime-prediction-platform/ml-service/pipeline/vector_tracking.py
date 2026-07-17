"""
MODULE: Criminal Vector Trajectory (Shadowing)
Identifies chronologically sequential crimes of the same type within a short time window,
calculates the directional movement vector (bearing), and projects the next likely target location.
"""
import logging
import math
import pandas as pd
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

class VectorTracker:
    def __init__(self):
        # Earth radius in kilometers
        self.R = 6371.0

    def _calculate_bearing(self, lat1, lon1, lat2, lon2):
        """Calculate the initial bearing from point 1 to point 2."""
        lat1, lon1, lat2, lon2 = map(math.radians, [lat1, lon1, lat2, lon2])
        dlon = lon2 - lon1

        x = math.sin(dlon) * math.cos(lat2)
        y = math.cos(lat1) * math.sin(lat2) - (math.sin(lat1) * math.cos(lat2) * math.cos(dlon))
        
        initial_bearing = math.atan2(x, y)
        initial_bearing = math.degrees(initial_bearing)
        compass_bearing = (initial_bearing + 360) % 360
        return compass_bearing

    def _calculate_destination(self, lat1, lon1, bearing, distance_km):
        """Calculate destination coordinates given a start point, bearing, and distance."""
        lat1 = math.radians(lat1)
        lon1 = math.radians(lon1)
        bearing = math.radians(bearing)

        lat2 = math.asin(
            math.sin(lat1) * math.cos(distance_km / self.R) +
            math.cos(lat1) * math.sin(distance_km / self.R) * math.cos(bearing)
        )
        
        lon2 = lon1 + math.atan2(
            math.sin(bearing) * math.sin(distance_km / self.R) * math.cos(lat1),
            math.cos(distance_km / self.R) - math.sin(lat1) * math.sin(lat2)
        )
        
        return math.degrees(lat2), math.degrees(lon2)

    def detect_trajectory(self, recent_crimes_df, crime_type, max_hours=24):
        """
        Analyzes recent crimes and projects a trajectory if a sequence is found.
        """
        # Filter for specific crime type within the timeframe
        mask = (recent_crimes_df['crime_type'] == crime_type) & (recent_crimes_df['latitude'] != 0)
        df = recent_crimes_df[mask].copy()
        
        # Sort chronologically
        df = df.sort_values(by='timestamp')
        
        if len(df) < 3:
            return None # Need at least 3 points to establish a confident vector
            
        # Get the latest 3-5 sequential crimes
        sequence = df.tail(4)
        
        # Calculate overall bearing from first to last in the sequence
        start_point = sequence.iloc[0]
        end_point = sequence.iloc[-1]
        
        bearing = self._calculate_bearing(
            start_point['latitude'], start_point['longitude'],
            end_point['latitude'], end_point['longitude']
        )
        
        # Calculate time difference and average speed
        time_diff_hours = (end_point['timestamp'] - start_point['timestamp']).total_seconds() / 3600.0
        
        # Prevent division by zero
        if time_diff_hours == 0:
            return None
            
        # Calculate distance between start and end
        # Simplified haversine for speed approx
        dist_km = math.sqrt((end_point['latitude'] - start_point['latitude'])**2 + (end_point['longitude'] - start_point['longitude'])**2) * 111.0
        speed_kmh = dist_km / time_diff_hours
        
        # Predict where they will be in 2 hours
        projection_distance_km = max(speed_kmh * 2.0, 2.0) # Project at least 2km ahead
        
        next_lat, next_lon = self._calculate_destination(
            end_point['latitude'], end_point['longitude'],
            bearing, projection_distance_km
        )
        
        logger.info(f"Detected {crime_type} trajectory. Bearing: {bearing:.1f}°. Projecting {projection_distance_km:.1f}km ahead.")
        
        # Generating GeoJSON for the Arrow/Line and the Target Zone Polygon
        trajectory_data = {
            "bearing": round(bearing, 1),
            "speed_kmh": round(speed_kmh, 1),
            "predicted_time": (end_point['timestamp'] + timedelta(hours=2)).strftime("%Y-%m-%d %H:%M:%S"),
            "geojson": {
                "type": "FeatureCollection",
                "features": [
                    {
                        "type": "Feature",
                        "geometry": {
                            "type": "LineString",
                            "coordinates": [
                                [start_point['longitude'], start_point['latitude']],
                                [end_point['longitude'], end_point['latitude']],
                                [next_lon, next_lat]
                            ]
                        },
                        "properties": {
                            "type": "trajectory_arrow",
                            "crime_type": crime_type
                        }
                    },
                    {
                        "type": "Feature",
                        "geometry": {
                            "type": "Point",
                            "coordinates": [next_lon, next_lat]
                        },
                        "properties": {
                            "type": "blockade_zone",
                            "radius_km": 1.5,
                            "warning": f"Projected Target Zone for {crime_type} suspects."
                        }
                    }
                ]
            }
        }
        return trajectory_data
