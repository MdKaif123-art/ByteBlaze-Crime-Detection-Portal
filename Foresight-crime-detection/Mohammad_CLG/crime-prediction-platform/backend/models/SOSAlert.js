const mongoose = require('mongoose');

const sosAlertSchema = new mongoose.Schema({
  reporter_id: { type: String, required: true },
  reporter_name: { type: String, default: 'Anonymous' },
  reporter_phone: { type: String },
  
  // Real-time Location
  location: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], required: true }, // [longitude, latitude]
  },
  
  // Incident type
  incident_type: { 
    type: String, 
    enum: ['GENERAL_EMERGENCY', 'MEDICAL', 'FIRE', 'CRIME_IN_PROGRESS', 'SUSPICIOUS_ACTIVITY'],
    default: 'GENERAL_EMERGENCY'
  },
  
  description: { type: String },
  
  // Status
  status: {
    type: String,
    enum: ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'FALSE_ALARM'],
    default: 'OPEN'
  },
  
  // Patrol Assignment
  assigned_unit: { type: String },
  response_time_minutes: { type: Number },
  
  // Temporal
  resolved_at: { type: Date }
  
}, {
  timestamps: true,
  collection: 'sos_alerts'
});

sosAlertSchema.index({ location: '2dsphere' });
sosAlertSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('SOSAlert', sosAlertSchema);
