/**
 * Docker Hub Pull Job Handler
 * Handles batch jobs for pulling container update information from Docker Hub
 */

const JobHandler = require('../JobHandler');
const containerService = require('../../containerService');

class DockerHubPullHandler extends JobHandler {
  getJobType() {
    return 'docker-hub-pull';
  }

  getDisplayName() {
    return 'Docker Hub Scan';
  }

  getDefaultConfig() {
    return {
      enabled: false,
      intervalMinutes: 60,
    };
  }

  async execute(context) {
    const { logger } = context;
    const result = {
      itemsChecked: 0,
      itemsUpdated: 0,
      logs: [],
      error: null,
    };

    try {
      logger.info('Starting Docker Hub pull batch job');
      
      // Execute the container service pull
      const serviceResult = await containerService.getAllContainersWithUpdates(true);
      
      // Extract metrics
      result.itemsChecked = serviceResult.containers?.length || 0;
      result.itemsUpdated = serviceResult.containers?.filter((c) => c.hasUpdate).length || 0;
      
      logger.info('Docker Hub pull completed successfully', {
        containersChecked: result.itemsChecked,
        containersUpdated: result.itemsUpdated,
      });

      return result;
    } catch (err) {
      const errorMessage = err.isRateLimitExceeded || err.message?.includes('rate limit')
        ? err.message || 'Docker Hub rate limit exceeded. Please wait a few minutes before trying again, or configure Docker Hub credentials in Settings for higher rate limits.'
        : err.message || 'Failed to pull container data';

      logger.error('Docker Hub pull failed', {
        error: errorMessage,
        stack: err.stack,
      });

      result.error = new Error(errorMessage);
      result.error.isRateLimitExceeded = err.isRateLimitExceeded || false;
      
      throw result.error;
    }
  }
}

module.exports = DockerHubPullHandler;

