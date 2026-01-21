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

    return {
      totalImages,
      inUse: uniqueImages.size,
      unused: unusedImagesCount,
      unusedPercentage: totalImages > 0 ? Math.round((unusedImagesCount / totalImages) * 100) : 0,
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
          <div className={styles.statCard}>
            <div className={styles.iconWrapper}>
              <Layers size={20} />
            </div>
            <div className={styles.statContent}>
              <div className={styles.statValue}>
                {shouldShowEmptyState ? 0 : imageStats.totalImages}
              </div>
              <div className={styles.statLabel}>Total Images</div>
            </div>
          </div>

          <div className={styles.statCard}>
            <div className={`${styles.iconWrapper} ${styles.success}`}>
              <HardDrive size={20} />
            </div>
            <div className={styles.statContent}>
              <div className={styles.statValue}>{shouldShowEmptyState ? 0 : imageStats.inUse}</div>
              <div className={styles.statLabel}>In Use</div>
            </div>
          </div>

          <div
            className={`${styles.statCard} ${styles.clickable} ${imageStats.unused > 0 ? styles.warning : ""}`}
            onClick={
              !shouldShowEmptyState && imageStats.unused > 0 ? onUnusedImagesClick : undefined
            }
          >
            <div className={`${styles.iconWrapper} ${imageStats.unused > 0 ? styles.warning : ""}`}>
              <Trash2 size={20} />
            </div>
            <div className={styles.statContent}>
              <div className={styles.statValue}>{shouldShowEmptyState ? 0 : imageStats.unused}</div>
              <div className={styles.statLabel}>Unused</div>
            </div>
          </div>
        </div>

        {!shouldShowEmptyState && imageStats.totalImages > 0 && (
          <>
            <div className={styles.progressSection}>
              <div className={styles.progressHeader}>
                <span className={styles.progressLabel}>Storage Usage</span>
                <span className={styles.progressValue}>
                  {imageStats.inUse}/{imageStats.totalImages} in use
                </span>
              </div>
              <div className={styles.progressBar}>
                <div
                  className={styles.progressFill}
                  style={{
                    width: `${100 - imageStats.unusedPercentage}%`,
                  }}
                />
              </div>
            </div>

            {imageStats.unused > 0 && (
              <div
                className={`${styles.cleanupTip} ${styles.clickable}`}
                onClick={onUnusedImagesClick}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onUnusedImagesClick();
                  }
                }}
              >
                <Trash2 size={16} className={styles.tipIcon} />
                <div className={styles.tipContent}>
                  <div className={styles.tipTitle}>Cleanup Available</div>
                  <div className={styles.tipText}>
                    {imageStats.unused} unused image{imageStats.unused !== 1 ? "s" : ""} can be
                    removed to free up space
                  </div>
                </div>
              </div>
            )}
          </>
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
