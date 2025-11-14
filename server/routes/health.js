/**
 * Health Check Routes
 * Provides health status and metrics for monitoring
 */

const express = require('express');
const { db } = require('../db/database');
const logger = require('../utils/logger');
const { ApiResponse } = require('../domain/dtos');
const { ExternalServiceError } = require('../domain/errors');

const router = express.Router();

/**
 * Basic health check
 * GET /api/health
 */
router.get('/', (req, res) => {
  res.json(ApiResponse.success({ status: 'ok' }));
});

/**
 * Detailed health check with system metrics
 * GET /api/health/detailed
 */
router.get('/detailed', async (req, res) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: {
      used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
      external: Math.round(process.memoryUsage().external / 1024 / 1024),
    },
    nodeVersion: process.version,
    environment: process.env.NODE_ENV || 'development',
  };

  // Check database connectivity
  try {
    await new Promise((resolve, reject) => {
      db.get('SELECT 1', (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    health.database = { status: 'ok' };
  } catch (error) {
    health.database = { status: 'error', error: error.message };
    health.status = 'degraded';
  }

  const statusCode = health.status === 'ok' ? 200 : 503;
  res.status(statusCode).json(ApiResponse.success(health));
});

/**
 * Readiness probe - checks if service is ready to accept traffic
 * GET /api/health/ready
 */
router.get('/ready', async (req, res) => {
  try {
    // Check database
    await new Promise((resolve, reject) => {
      db.get('SELECT 1', (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    res.status(200).json(ApiResponse.success({ ready: true }));
  } catch (error) {
    logger.error('Readiness check failed', {
      module: 'health',
      error: error,
    });
    res.status(503).json(ApiResponse.error('Service not ready'));
  }
});

/**
 * Liveness probe - checks if service is alive
 * GET /api/health/live
 */
router.get('/live', (req, res) => {
  res.status(200).json(ApiResponse.success({ alive: true }));
});

module.exports = router;

