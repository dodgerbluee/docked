import React, { useMemo } from "react";
import PropTypes from "prop-types";
import { Package, Trash2, HardDrive, Layers } from "lucide-react";
import styles from "./ImageStatistics.module.css";

/**
 * Image statistics component showing Docker image information
 */
const ImageStatistics = ({
  containers,
  unusedImages,
  unusedImagesCount,
  shouldShowEmptyState,
  onUnusedImagesClick,
}) => {
  const imageStats = useMemo(() => {
    // Count unique images from containers
    const uniqueImages = new Set();
    containers.forEach((container) => {
      if (container.image) {
        uniqueImages.add(container.image);
      }
    });

    // Calculate total images (in use + unused)
    const totalImages = uniqueImages.size + unusedImagesCount;

    const inUsePct =
      totalImages > 0 ? Math.round((uniqueImages.size / totalImages) * 100) : 0;
    const unusedPct =
      totalImages > 0 ? Math.round((unusedImagesCount / totalImages) * 100) : 0;

    return {
      totalImages,
      inUse: uniqueImages.size,
      unused: unusedImagesCount,
      inUsePercentage: inUsePct,
      unusedPercentage: unusedPct,
    };
  }, [containers, unusedImagesCount]);

  return (
    <div className={styles.imageStats}>
      <div className={styles.header}>
        <div className={styles.headerContent}>
          <Package size={20} className={styles.headerIcon} />
          <h3 className={styles.title}>Image Statistics</h3>
        </div>
      </div>

      <div className={styles.content}>
        <div className={styles.statsGrid}>
          <div className={styles.statItem}>
            <div className={styles.statIcon}>
              <Layers size={18} />
            </div>
            <div className={styles.statContent}>
              <div className={styles.statValue}>
                {shouldShowEmptyState ? 0 : imageStats.totalImages}
              </div>
              <div className={styles.statLabel}>Total Images</div>
            </div>
          </div>

          <div className={`${styles.statItem} ${styles.success}`}>
            <div className={styles.statIcon}>
              <HardDrive size={18} />
            </div>
            <div className={styles.statContent}>
              <div className={styles.statValue}>{shouldShowEmptyState ? 0 : imageStats.inUse}</div>
              <div className={styles.statLabel}>In Use</div>
            </div>
          </div>

          <div
            className={`${styles.statItem} ${styles.clickable} ${imageStats.unused > 0 ? styles.warning : ""}`}
            onClick={
              !shouldShowEmptyState && imageStats.unused > 0 ? onUnusedImagesClick : undefined
            }
            role={imageStats.unused > 0 ? "button" : undefined}
            tabIndex={imageStats.unused > 0 ? 0 : undefined}
            onKeyDown={(e) => {
              if (
                imageStats.unused > 0 &&
                (e.key === "Enter" || e.key === " ") &&
                onUnusedImagesClick
              ) {
                e.preventDefault();
                onUnusedImagesClick();
              }
            }}
          >
            <div className={styles.statIcon}>
              <Trash2 size={18} />
            </div>
            <div className={styles.statContent}>
              <div className={styles.statValue}>{shouldShowEmptyState ? 0 : imageStats.unused}</div>
              <div className={styles.statLabel}>Unused</div>
            </div>
          </div>
        </div>

        {!shouldShowEmptyState && imageStats.totalImages > 0 && (
          <div className={styles.progressSection}>
            <div className={styles.progressHeader}>
              <span className={styles.progressValue}>
                {imageStats.inUse}/{imageStats.totalImages} in use
              </span>
            </div>
            <div className={styles.progressBarTrack}>
              {imageStats.inUse > 0 && (
                <div
                  className={`${styles.progressBarSegment} ${styles.inUse}`}
                  style={{ width: `${imageStats.inUsePercentage}%` }}
                  title={`${imageStats.inUse} in use`}
                />
              )}
              {imageStats.unused > 0 && (
                <div
                  className={`${styles.progressBarSegment} ${styles.unused}`}
                  style={{ width: `${imageStats.unusedPercentage}%` }}
                  title={`${imageStats.unused} unused`}
                />
              )}
            </div>
            <div className={styles.progressBarLegend}>
              <div className={styles.legendItem}>
                <span className={`${styles.legendDot} ${styles.inUse}`} />
                <span className={styles.legendLabel}>In Use</span>
              </div>
              <div className={styles.legendItem}>
                <span className={`${styles.legendDot} ${styles.unused}`} />
                <span className={styles.legendLabel}>Unused</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

ImageStatistics.propTypes = {
  containers: PropTypes.array,
  unusedImages: PropTypes.array,
  unusedImagesCount: PropTypes.number,
  shouldShowEmptyState: PropTypes.bool,
  onUnusedImagesClick: PropTypes.func,
};

ImageStatistics.defaultProps = {
  containers: [],
  unusedImages: [],
  unusedImagesCount: 0,
  shouldShowEmptyState: false,
};

export default ImageStatistics;
