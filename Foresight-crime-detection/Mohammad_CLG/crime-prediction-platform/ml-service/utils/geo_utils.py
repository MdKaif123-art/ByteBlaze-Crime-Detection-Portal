"""
GeoJSON & Geospatial Utilities
"""
import math
import numpy as np
from shapely.geometry import MultiPoint, mapping


def haversine_distance(lat1, lon1, lat2, lon2):
    """Calculate distance between two points in kilometers."""
    R = 6371  # Earth radius in km
    lat1, lon1, lat2, lon2 = map(math.radians, [lat1, lon1, lat2, lon2])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return R * 2 * math.asin(math.sqrt(a))


def points_to_convex_hull(lats, lons):
    """Convert a set of lat/lon points to a convex hull polygon (GeoJSON)."""
    if len(lats) < 3:
        return None
    points = list(zip(lons, lats))  # GeoJSON uses [lon, lat]
    mp = MultiPoint(points)
    hull = mp.convex_hull
    return mapping(hull)


def create_geojson_point(lat, lon, properties=None):
    """Create a GeoJSON Feature with Point geometry."""
    return {
        "type": "Feature",
        "geometry": {
            "type": "Point",
            "coordinates": [lon, lat],
        },
        "properties": properties or {},
    }


def create_geojson_feature_collection(features):
    """Wrap features into a GeoJSON FeatureCollection."""
    return {
        "type": "FeatureCollection",
        "features": features,
    }


def create_heatmap_data(df, value_col=None):
    """
    Convert DataFrame with lat/lon into Leaflet-compatible heatmap data.
    Returns list of [lat, lon, intensity].
    """
    points = []
    for _, row in df.iterrows():
        intensity = row[value_col] if value_col and value_col in row else 1.0
        points.append([float(row["latitude"]), float(row["longitude"]), float(intensity)])
    return points


def create_risk_zone_geojson(clusters_df):
    """
    Generate GeoJSON polygons for risk zones from cluster data.
    Each cluster becomes a polygon with risk-level styling.
    Also exports overriding predominant crime types for specific colour mapping.
    """
    features = []
    risk_colors = {
        "CRITICAL": "#FF0000",
        "HIGH": "#FF6600",
        "MEDIUM": "#FFCC00",
        "LOW": "#00CC66",
    }

    # Custom category colors
    category_colors = {
        "IPC_VIOLENT": "#8b0000", # Dark red
        "IPC_WOMEN_CHILDREN": "#ff1493", # Deep pink
        "NDPS_ACT": "#9400d3", # Violet
        "ARMS_ACT": "#808080", # Gray
        "ROAD_ACCIDENT": "#ff8c00" # Dark Orange
    }

    for _, cluster in clusters_df.iterrows():
        if cluster.get("boundary"):
            predominant_category = cluster.get("predominant_legal_category", "GENERAL_IPC")
            
            # Decide color based on whether we prioritize category mapping or risk mapping
            base_color = risk_colors.get(cluster.get("risk_level", "LOW"), "#00CC66")
            category_color = category_colors.get(predominant_category, base_color)
            
            feature = {
                "type": "Feature",
                "geometry": cluster["boundary"],
                "properties": {
                    "cluster_id": int(cluster["cluster_id"]),
                    "risk_level": cluster.get("risk_level", "LOW"),
                    "risk_score": float(cluster.get("risk_score", 0)),
                    "crime_count": int(cluster.get("crime_count", 0)),
                    "avg_severity": float(cluster.get("avg_severity", 0)),
                    "legal_category": predominant_category,
                    "fill_color": category_color, # Multi-coloured based on specific target crime
                    "fill_opacity": 0.3 + 0.1 * (cluster.get("risk_score", 0) / 25),
                },
            }
            features.append(feature)

    return create_geojson_feature_collection(features)


def lat_lon_to_grid(lat, lon, grid_size_km=1.0):
    """
    Convert lat/lon to a grid cell ID.
    grid_size_km determines the cell size.
    """
    # Approximate degrees per km
    lat_deg_per_km = 1 / 111.0
    lon_deg_per_km = 1 / (111.0 * math.cos(math.radians(lat)))

    grid_lat = int(lat / (grid_size_km * lat_deg_per_km))
    grid_lon = int(lon / (grid_size_km * lon_deg_per_km))

    return f"{grid_lat}_{grid_lon}"


def compute_cluster_boundary(lats, lons, buffer_km=0.5):
    """
    Compute a buffered convex hull boundary for a cluster.
    Returns GeoJSON geometry.
    """
    if len(lats) < 3:
        # For < 3 points, create a circular buffer around centroid
        center_lat = np.mean(lats)
        center_lon = np.mean(lons)
        # Create a circle approximation (16 points)
        angles = np.linspace(0, 2 * math.pi, 16, endpoint=False)
        buffer_deg = buffer_km / 111.0
        ring = [
            [
                float(center_lon + buffer_deg * math.cos(a)),
                float(center_lat + buffer_deg * math.sin(a)),
            ]
            for a in angles
        ]
        ring.append(ring[0])  # close the ring
        return {"type": "Polygon", "coordinates": [ring]}

    points = list(zip(lons, lats))
    mp = MultiPoint(points)
    hull = mp.convex_hull
    # Buffer the hull slightly
    buffer_deg = buffer_km / 111.0
    buffered = hull.buffer(buffer_deg)
    return mapping(buffered)
