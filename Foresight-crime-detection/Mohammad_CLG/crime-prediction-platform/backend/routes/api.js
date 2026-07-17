const express = require('express');
const router = express.Router();
const crimeController = require('../controllers/crimeController');
const sosController = require('../controllers/sosController');
const multer = require('multer');

// Use in-memory storage to avoid filesystem permission/path issues.
const upload = multer({ storage: multer.memoryStorage() });

// ── ML Integration Routes ──
router.post('/upload-data', upload.single('file'), crimeController.uploadFIR); // Upload FIR CSV → ML service
router.post('/train', crimeController.trainModel);
router.get('/hotspots', crimeController.getHotspots);
router.get('/risk-zones', crimeController.getRiskZones);
router.get('/predictions', crimeController.getPredictions);
router.get('/evaluation', crimeController.getEvaluation);
router.post('/patrol-route', crimeController.getPatrolRoute);
router.post('/radius-intelligence', crimeController.getRadiusIntelligence);

// ── KILLER FEATURES Routes ──
router.post('/test-cctns', crimeController.testCCTNSFIR);
router.get('/briefing/:cluster_id', crimeController.getGenAIBriefing);
router.get('/trajectory/:crime_type', crimeController.getCriminalTrajectory);

// ── Database Routes ──
router.get('/crimes/recent', crimeController.getRecentCrimes);

// ── SOS Routes ──
router.post('/sos', sosController.triggerSOS);
router.get('/sos/active', sosController.getActiveSOSAlerts);
router.patch('/sos/:id/status', sosController.updateAlertStatus);

module.exports = router;
