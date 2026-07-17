const SOSAlert = require('../models/SOSAlert');
const logger = require('../utils/logger');

exports.triggerSOS = async (req, res) => {
  try {
    const { reporter_id, reporter_name, reporter_phone, lat, lon, incident_type, description } = req.body;

    if (!lat || !lon || !reporter_id) {
      return res.status(400).json({ error: 'Lat, lon, and reporter_id are required' });
    }

    const newAlert = new SOSAlert({
      reporter_id,
      reporter_name,
      reporter_phone,
      location: {
        type: 'Point',
        coordinates: [parseFloat(lon), parseFloat(lat)]
      },
      incident_type,
      description
    });

    const savedAlert = await newAlert.save();

    // Broadcast globally via socket (Attached in server.js)
    if (req.app.get('io')) {
      req.app.get('io').emit('sos_alert', {
        id: savedAlert._id,
        reporter: reporter_name,
        lat: lat,
        lon: lon,
        type: incident_type,
        time: savedAlert.createdAt
      });
    }

    res.status(201).json({
      message: 'SOS Alert triggered successfully',
      alert_id: savedAlert._id
    });
    
  } catch (error) {
    logger.error('Error triggering SOS:', error);
    res.status(500).json({ error: 'Failed to trigger SOS alert' });
  }
};

exports.getActiveSOSAlerts = async (req, res) => {
  try {
    const activeAlerts = await SOSAlert.find({ status: { $in: ['OPEN', 'ASSIGNED', 'IN_PROGRESS'] } })
      .sort({ createdAt: -1 });
      
    res.json(activeAlerts);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch active alerts' });
  }
};

exports.updateAlertStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, assigned_unit } = req.body;

    const alert = await SOSAlert.findById(id);
    if (!alert) return res.status(404).json({ error: 'Alert not found' });

    alert.status = status || alert.status;
    if (assigned_unit) alert.assigned_unit = assigned_unit;
    
    if (['RESOLVED', 'FALSE_ALARM'].includes(status)) {
        alert.resolved_at = new Date();
    }

    await alert.save();

    if (req.app.get('io')) {
      req.app.get('io').emit('sos_status_update', {
        id: alert._id,
        status: alert.status,
        assigned_unit: alert.assigned_unit
      });
    }

    res.json({ message: 'Status updated', alert });
  } catch (error) {
    logger.error('Error updating SOS:', error);
    res.status(500).json({ error: 'Failed to update alert' });
  }
};
