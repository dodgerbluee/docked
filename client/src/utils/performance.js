/**
 * Performance monitoring utilities for mobile optimization
 */

import React from "react";

// Simple performance metrics tracking
class PerformanceMonitor {
  constructor() {
    this.metrics = {};
    this.observers = [];
  }

  // Measure page load performance
  measurePageLoad() {
    if ("performance" in window) {
      const navigation = performance.getEntriesByType("navigation")[0];
      const paint = performance.getEntriesByType("paint");

      const metrics = {
        domContentLoaded:
          navigation.domContentLoadedEventEnd - navigation.domContentLoadedEventStart,
        loadComplete: navigation.loadEventEnd - navigation.loadEventStart,
        firstPaint: paint.find((p) => p.name === "first-paint")?.startTime,
        firstContentfulPaint: paint.find((p) => p.name === "first-contentful-paint")?.startTime,
        totalLoadTime: navigation.loadEventEnd - navigation.fetchStart,
      };

      this.metrics.pageLoad = metrics;
      this.logMetrics("Page Load", metrics);
      return metrics;
    }
    return null;
  }

  // Measure component render time
  measureComponentRender(componentName, renderFunction) {
    const start = performance.now();
    const result = renderFunction();
    const end = performance.now();
    const duration = end - start;

    if (!this.metrics.components) {
      this.metrics.components = {};
    }
    this.metrics.components[componentName] = (this.metrics.components[componentName] || []).concat(
      duration
    );

    if (duration > 100) {
      // Log slow renders
      console.warn(`Slow render detected: ${componentName} took ${duration.toFixed(2)}ms`);
    }

    return result;
  }

  // Monitor Core Web Vitals
  monitorCoreWebVitals() {
    if ("PerformanceObserver" in window) {
      // Largest Contentful Paint (LCP)
      const lcpObserver = new PerformanceObserver((entryList) => {
        const entries = entryList.getEntries();
        const lastEntry = entries[entries.length - 1];
        this.metrics.lcp = lastEntry.startTime;
        this.logMetrics("Largest Contentful Paint", { lcp: lastEntry.startTime });
      });
      lcpObserver.observe({ entryTypes: ["largest-contentful-paint"] });
      this.observers.push(lcpObserver);

      // First Input Delay (FID)
      const fidObserver = new PerformanceObserver((entryList) => {
        const entries = entryList.getEntries();
        entries.forEach((entry) => {
          this.metrics.fid = entry.processingStart - entry.startTime;
          this.logMetrics("First Input Delay", { fid: this.metrics.fid });
        });
      });
      fidObserver.observe({ entryTypes: ["first-input"] });
      this.observers.push(fidObserver);

      // Cumulative Layout Shift (CLS)
      let clsScore = 0;
      const clsObserver = new PerformanceObserver((entryList) => {
        entryList.getEntries().forEach((entry) => {
          if (!entry.hadRecentInput) {
            clsScore += entry.value;
          }
        });
        this.metrics.cls = clsScore;
        this.logMetrics("Cumulative Layout Shift", { cls: clsScore });
      });
      clsObserver.observe({ entryTypes: ["layout-shift"] });
      this.observers.push(clsObserver);
    }
  }

  // Log metrics to console and optionally to analytics
  logMetrics(name, metrics) {
    if (process.env.NODE_ENV === "development") {
      console.group(`🔍 Performance: ${name}`);
      Object.entries(metrics).forEach(([key, value]) => {
        const status = this.getMetricStatus(key, value);
        console.log(`${key}: ${typeof value === "number" ? value.toFixed(2) : value} ${status}`);
      });
      console.groupEnd();
    }
  }

  // Get status indicator for metrics
  getMetricStatus(metric, value) {
    const thresholds = {
      lcp: { good: 2500, poor: 4000 },
      fid: { good: 100, poor: 300 },
      cls: { good: 0.1, poor: 0.25 },
      loadComplete: { good: 3000, poor: 5000 },
    };

    if (thresholds[metric]) {
      if (value <= thresholds[metric].good) return "✅";
      if (value <= thresholds[metric].poor) return "⚠️";
      return "❌";
    }
    return "";
  }

  // Get performance report
  getReport() {
    return {
      ...this.metrics,
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      connection: navigator.connection
        ? {
            effectiveType: navigator.connection.effectiveType,
            downlink: navigator.connection.downlink,
            rtt: navigator.connection.rtt,
          }
        : null,
    };
  }

  // Cleanup observers
  cleanup() {
    this.observers.forEach((observer) => observer.disconnect());
    this.observers = [];
  }
}

// Mobile-specific performance utilities
export const MobilePerformance = {
  // Check if device is low-end
  isLowEndDevice() {
    const memory = navigator.deviceMemory || 4;
    const cores = navigator.hardwareConcurrency || 4;
    const connection = navigator.connection;

    return (
      memory <= 2 ||
      cores <= 2 ||
      (connection && ["slow-2g", "2g", "3g"].includes(connection.effectiveType))
    );
  },

  // Optimize images for mobile
  optimizeImagesSrc(src, width, height) {
    if (!src) return src;

    // Basic optimization - add size parameters if CDN supports it
    if (src.includes("cloudinary") || src.includes("imgix")) {
      return `${src}?w=${width}&h=${height}&q=80&auto=format`;
    }

    return src;
  },

  // Lazy load components
  lazyLoad(componentImport, fallback = null) {
    return React.lazy(() =>
      componentImport().catch((error) => {
        console.warn("Failed to load component:", error);
        return { default: fallback || (() => React.createElement("div", null, "Loading failed")) };
      })
    );
  },

  // Debounce scroll events for mobile performance
  debounceScroll(callback, delay = 100) {
    let timeoutId;
    return (...args) => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => callback.apply(this, args), delay);
    };
  },
};

// Create global performance monitor instance
export const performanceMonitor = new PerformanceMonitor();

// Initialize performance monitoring
export const initializePerformanceMonitoring = () => {
  // Page load metrics
  if (document.readyState === "complete") {
    performanceMonitor.measurePageLoad();
  } else {
    window.addEventListener("load", () => {
      performanceMonitor.measurePageLoad();
    });
  }

  // Core Web Vitals
  performanceMonitor.monitorCoreWebVitals();
};

export default PerformanceMonitor;
