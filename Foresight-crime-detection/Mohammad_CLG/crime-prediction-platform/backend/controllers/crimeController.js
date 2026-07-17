const axios = require('axios');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const logger = require('../utils/logger');

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://127.0.0.1:8000';

// Proxy endpoints to ML Service
exports.trainModel = async (req, res) => {
  try {
    const response = await axios.post(`${ML_SERVICE_URL}/api/v1/ml/train/fir-dataset`);
    res.json(response.data);
  } catch (error) {
    logger.error('Error triggering training:', error.message);
    res.status(500).json({ error: 'Failed to trigger training pipeline in ML service' });
  }
};

exports.getHotspots = async (req, res) => {
  try {
    const response = await axios.get(`${ML_SERVICE_URL}/api/v1/ml/hotspots`);
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch hotspots from ML service' });
  }
};

exports.getRiskZones = async (req, res) => {
  try {
    const response = await axios.get(`${ML_SERVICE_URL}/api/v1/ml/hotspots/geojson`);
    res.json(response.data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch risk zones GeoJSON' });
  }
};

exports.getPredictions = async (req, res) => {
  const { level = 'district_name', area_id, grid_cell, horizon = 7 } = req.query;
  const resolvedArea = area_id || grid_cell;
  if (!resolvedArea) {
    return res.status(400).json({ error: 'area_id (or grid_cell) parameter is required' });
  }
  
  try {
    const response = await axios.post(`${ML_SERVICE_URL}/api/v1/ml/predict`, {
      level,
      area_id: resolvedArea,
      grid_cell: grid_cell || null,
      horizon_days: parseInt(horizon)
    });
    res.json(response.data);
  } catch (error) {
    logger.error('Error fetching predictions:', error.message);
    res.status(500).json({ error: 'Failed to fetch predictions' });
  }
};

exports.getEvaluation = async (req, res) => {
  try {
    const response = await axios.get(`${ML_SERVICE_URL}/api/v1/ml/evaluation`);
    res.json(response.data);
  } catch (error) {
    logger.error('Error fetching evaluation:', error.message);
    res.status(500).json({ error: 'Failed to fetch evaluation report' });
  }
};

exports.uploadFIR = async (req, res) => {
  try {
    // Expect middleware (multer) in route; but if not present, pass through body.
    // If file exists, stream it to ML service as multipart.
    if (req.file) {
      const form = new FormData();
      form.append('file', req.file.buffer, {
        filename: req.file.originalname || 'uploaded.csv',
        contentType: req.file.mimetype || 'text/csv'
      });
      const response = await axios.post(`${ML_SERVICE_URL}/api/v1/ml/upload-fir`, form, {
        headers: form.getHeaders()
      });
      return res.json(response.data);
    }

    // Fallback: no file middleware; just trigger training
    const response = await axios.post(`${ML_SERVICE_URL}/api/v1/ml/train/fir-dataset`);
    return res.json(response.data);
  } catch (error) {
    logger.error('Error uploading FIR:', error.message);
    const detail = error.response && error.response.data && (error.response.data.detail || error.response.data.error || error.response.data.message);
    res.status(error.response?.status || 500).json({ 
      error: detail || 'Failed to upload FIR to ML service',
      detail: detail || error.message
    });
  }
};

exports.getRadiusIntelligence = async (req, res) => {
  try {
    const response = await axios.post(`${ML_SERVICE_URL}/api/v1/ml/radius-intelligence`, req.body);
    res.json(response.data);
  } catch (error) {
    logger.error('Error fetching radius intelligence:', error.message);
    res.status(500).json({ error: 'Failed to fetch radius intelligence' });
  }
};

exports.getPatrolRoute = async (req, res) => {
  const { lat, lon, max_zones = 5, target_season = null } = req.body;
  
  if (!lat || !lon) {
    return res.status(400).json({ error: 'station lat and lon are required' });
  }
  
  try {
    const payload = {
      station_lat: parseFloat(lat),
      station_lon: parseFloat(lon),
      max_zones: parseInt(max_zones)
    };
    if (target_season) payload.target_season = target_season;

    const response = await axios.post(`${ML_SERVICE_URL}/api/v1/ml/patrol/optimize`, payload);
    res.json(response.data);
  } catch (error) {
    logger.error('Error calculating patrol route:', error.message);
    res.status(500).json({ error: 'Failed to calculate optimal route' });
  }
};

// ── KILLER FEATURES ──
exports.getGenAIBriefing = async (req, res) => {
  try {
    const { cluster_id } = req.params;
    const response = await axios.get(`${ML_SERVICE_URL}/api/v1/ml/genai/briefing/${cluster_id}`);
    res.json(response.data);
  } catch (error) {
    logger.error('Error fetching GenAI Briefing:', error.message);
    res.status(500).json({ error: 'Failed to generate dispatch briefing' });
  }
};

exports.getCriminalTrajectory = async (req, res) => {
  try {
    const { crime_type } = req.params;
    const response = await axios.get(`${ML_SERVICE_URL}/api/v1/ml/trajectory/${crime_type}`);
    res.json(response.data);
  } catch (error) {
    logger.error('Error calculating trajectory:', error.message);
    res.status(500).json({ error: 'Failed to calculate criminal trajectory' });
  }
};

exports.testCCTNSFIR = async (req, res) => {
  try {
    const response = await axios.post(`${ML_SERVICE_URL}/api/v1/ml/test-new-fir`, req.body);
    res.json(response.data);
  } catch (error) {
    logger.error('Error testing live FIR:', error.message);
    res.status(500).json({ error: 'Failed to test LIVE FIR data.' });
  }
};

// Database specific endpoints
exports.getRecentCrimes = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    // DB is optional in this project; if models aren't present/configured, return empty dataset.
    let Crime;
    try {
      // eslint-disable-next-line global-require
      Crime = require('../models/Crime');
    } catch (e) {
      Crime = null;
    }

    if (!Crime) {
      return res.json({ count: 0, data: [], warning: 'DB not configured; returning empty recent crimes.' });
    }

    const crimes = await Crime.find({ coordinates_geocoded: false })
      .sort({ timestamp: -1 })
      .limit(limit);

    return res.json({ count: crimes.length, data: crimes });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch crimes from DB' });
  }
};
