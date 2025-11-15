/**
 * Unit tests for BatchLogger
 */

const BatchLogger = require('../Logger');

describe('BatchLogger', () => {
  let logger;

  beforeEach(() => {
    logger = new BatchLogger('test-job');
  });

  describe('constructor', () => {
    it('should create logger with job type', () => {
      expect(logger.jobType).toBe('test-job');
      expect(logger.logs).toEqual([]);
    });

    it('should default to system job type', () => {
      const systemLogger = new BatchLogger();
      expect(systemLogger.jobType).toBe('system');
    });
  });

  describe('log', () => {
    it('should log message with timestamp and metadata', () => {
      logger.log('info', 'Test message', { key: 'value' });
      
      expect(logger.logs).toHaveLength(1);
      expect(logger.logs[0]).toMatchObject({
        level: 'info',
        jobType: 'test-job',
        message: 'Test message',
        key: 'value',
      });
      expect(logger.logs[0].timestamp).toBeDefined();
    });

    it('should log error level to console', () => {
      logger.log('error', 'Error message');
      
      // Verify error log is stored in memory
      expect(logger.logs).toHaveLength(1);
      expect(logger.logs[0].level).toBe('error');
      expect(logger.logs[0].message).toBe('Error message');
      expect(logger.logs[0].timestamp).toBeDefined();
    });

    it('should log warn level to console', () => {
      logger.log('warn', 'Warning message');
      
      // Verify warn log is stored in memory
      expect(logger.logs).toHaveLength(1);
      expect(logger.logs[0].level).toBe('warn');
      expect(logger.logs[0].message).toBe('Warning message');
      expect(logger.logs[0].timestamp).toBeDefined();
    });
  });

  describe('convenience methods', () => {
    it('should have info method', () => {
      logger.info('Info message');
      expect(logger.logs[0].level).toBe('info');
    });

    it('should have warn method', () => {
      logger.warn('Warning message');
      expect(logger.logs[0].level).toBe('warn');
    });

    it('should have error method', () => {
      logger.error('Error message');
      expect(logger.logs[0].level).toBe('error');
    });
  });

  describe('getFormattedLogs', () => {
    it('should return formatted log string', () => {
      logger.info('Message 1');
      logger.error('Message 2', { error: 'test' });
      
      const formatted = logger.getFormattedLogs();
      expect(formatted).toContain('Message 1');
      expect(formatted).toContain('Message 2');
      expect(formatted).toContain('error="test"');
    });
  });

  describe('getLogs', () => {
    it('should return copy of logs array', () => {
      logger.info('Test');
      const logs = logger.getLogs();
      expect(logs).toHaveLength(1);
      expect(logs).not.toBe(logger.logs); // Should be a copy
    });
  });

  describe('clear', () => {
    it('should clear all logs', () => {
      logger.info('Test');
      expect(logger.logs).toHaveLength(1);
      logger.clear();
      expect(logger.logs).toHaveLength(0);
    });
  });
});

