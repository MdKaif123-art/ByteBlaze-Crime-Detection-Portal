require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');

const connectDB = require('./config/db');
const logger = require('./utils/logger');
const apiRoutes = require('./routes/api');

// Initialize App
const app = express();
const server = http.createServer(app);

// Init WebSockets
const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    methods: ['GET', 'POST']
  }
});
app.set('io', io); // Make Accessible to controllers

// Connect to MongoDB
connectDB();

// Middleware
app.use(helmet());
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request Logging
app.use(morgan('combined', {
  stream: { write: message => logger.http(message.trim()) }
}));

// Rate Limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
});
app.use('/api', limiter);

// Routes
app.use('/api/v1', apiRoutes);

// Root path
app.get('/', (req, res) => {
  res.json({ message: 'Crime Prediction Platform API is running.' });
});

// WebSocket Events
io.on('connection', (socket) => {
  logger.info(`Client connected via WebSocket: ${socket.id}`);

  socket.on('join_patrol_room', (unitId) => {
    socket.join(`patrol_${unitId}`);
    logger.info(`Unit ${unitId} joined their patrol room.`);
  });

  socket.on('disconnect', () => {
    logger.info(`Client disconnected: ${socket.id}`);
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error(err.stack);
  res.status(500).json({ error: 'Internal Server Error' });
});

// Start Server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  logger.info(`Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
});
