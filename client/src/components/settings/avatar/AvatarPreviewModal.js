import React, { useMemo, useCallback, useEffect } from "react";
import PropTypes from "prop-types";
import Modal from "../../ui/Modal";
import Button from "../../ui/Button";
import { cropImage } from "./AvatarCropper";
import styles from "./AvatarPreviewModal.module.css";

const PREVIEW_SIZE = 400;

/**
 * AvatarPreviewModal Component
 * Modal for previewing and adjusting avatar before upload
 */
const AvatarPreviewModal = React.memo(function AvatarPreviewModal({
  isOpen,
  onClose,
  imageSrc,
  imageElement,
  crop,
  zoom,
  pan,
  onZoomChange,
  onPanChange,
  onUpload,
  isUploading,
}) {
  const [isDragging, setIsDragging] = React.useState(false);
  const [dragStart, setDragStart] = React.useState({ x: 0, y: 0 });

  // Calculate image dimensions and constraints
  const imageConstraints = useMemo(() => {
    if (!imageElement) return null;

    const aspect = imageElement.width / imageElement.height;
    let displayedWidth, displayedHeight;
    if (aspect > 1) {
      displayedWidth = PREVIEW_SIZE;
      displayedHeight = PREVIEW_SIZE / aspect;
    } else {
      displayedHeight = PREVIEW_SIZE;
      displayedWidth = PREVIEW_SIZE * aspect;
    }

    const zoomedWidth = displayedWidth * zoom;
    const zoomedHeight = displayedHeight * zoom;

    // Calculate pan bounds to ensure crop area is always covered
    // The crop area must always be within the bounds of the displayed image
    // Image position: offsetX = (PREVIEW_SIZE - zoomedWidth) / 2 + pan.x
    // We need: imageLeft <= cropLeft AND imageRight >= cropRight
    //         imageTop <= cropTop AND imageBottom >= cropBottom
    
    const centerOffsetX = (PREVIEW_SIZE - zoomedWidth) / 2;
    const centerOffsetY = (PREVIEW_SIZE - zoomedHeight) / 2;

    // Crop area bounds
    const cropLeft = crop.x;
    const cropRight = crop.x + crop.width;
    const cropTop = crop.y;
    const cropBottom = crop.y + crop.height;

    // Constraints:
    // centerOffsetX + pan.x <= cropLeft  =>  pan.x <= cropLeft - centerOffsetX
    // centerOffsetX + pan.x + zoomedWidth >= cropRight  =>  pan.x >= cropRight - centerOffsetX - zoomedWidth
    const maxPanX = cropLeft - centerOffsetX;
    const minPanX = cropRight - centerOffsetX - zoomedWidth;

    // Same for Y:
    const maxPanY = cropTop - centerOffsetY;
    const minPanY = cropBottom - centerOffsetY - zoomedHeight;

    return {
      displayedWidth,
      displayedHeight,
      zoomedWidth,
      zoomedHeight,
      minPanX: Math.min(minPanX, maxPanX),
      maxPanX: Math.max(minPanX, maxPanX),
      minPanY: Math.min(minPanY, maxPanY),
      maxPanY: Math.max(minPanY, maxPanY),
    };
  }, [imageElement, zoom, crop]);

  // Constrain pan values to keep image within bounds
  const constrainPan = useCallback(
    (newPan) => {
      if (!imageConstraints) return newPan;

      return {
        x: Math.max(imageConstraints.minPanX, Math.min(imageConstraints.maxPanX, newPan.x)),
        y: Math.max(imageConstraints.minPanY, Math.min(imageConstraints.maxPanY, newPan.y)),
      };
    },
    [imageConstraints]
  );

  // Calculate min/max zoom values
  const zoomBounds = useMemo(() => {
    if (!imageElement) return { min: 0.5, max: 2 };

    const aspect = imageElement.width / imageElement.height;
    let displayedWidth, displayedHeight;
    if (aspect > 1) {
      displayedWidth = PREVIEW_SIZE;
      displayedHeight = PREVIEW_SIZE / aspect;
    } else {
      displayedHeight = PREVIEW_SIZE;
      displayedWidth = PREVIEW_SIZE * aspect;
    }

    // Minimum zoom: image must cover the entire crop area
    // The crop area is typically centered and square, so we need to ensure
    // the image covers at least the crop width/height
    const minZoom = Math.max(
      crop.width / displayedWidth,
      crop.height / displayedHeight,
      0.5 // Absolute minimum
    );
    // Maximum zoom: reasonable limit
    const maxZoom = 3;

    return { min: minZoom, max: maxZoom };
  }, [imageElement, crop]);

  // Constrain zoom to ensure image always covers crop area
  const constrainZoom = useCallback(
    (newZoom) => {
      return Math.max(zoomBounds.min, Math.min(zoomBounds.max, newZoom));
    },
    [zoomBounds]
  );

  const handleMouseDown = useCallback(
    (e) => {
      setIsDragging(true);
      setDragStart({
        x: e.clientX - pan.x,
        y: e.clientY - pan.y,
      });
    },
    [pan]
  );

  const handleMouseMove = useCallback(
    (e) => {
      if (isDragging) {
        const newPan = {
          x: e.clientX - dragStart.x,
          y: e.clientY - dragStart.y,
        };
        const constrainedPan = constrainPan(newPan);
        onPanChange(constrainedPan);
      }
    },
    [isDragging, dragStart, constrainPan, onPanChange]
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleZoomChange = useCallback(
    (newZoom) => {
      const constrainedZoom = constrainZoom(newZoom);
      onZoomChange(constrainedZoom);
    },
    [constrainZoom, onZoomChange]
  );

  // Constrain zoom value when bounds change
  useEffect(() => {
    const constrainedZoom = constrainZoom(zoom);
    if (Math.abs(constrainedZoom - zoom) > 0.01) {
      onZoomChange(constrainedZoom);
    }
  }, [zoomBounds, zoom, constrainZoom, onZoomChange]);

  // Constrain pan whenever zoom or image constraints change
  useEffect(() => {
    if (imageConstraints) {
      const constrainedPan = constrainPan(pan);
      if (Math.abs(constrainedPan.x - pan.x) > 0.1 || Math.abs(constrainedPan.y - pan.y) > 0.1) {
        onPanChange(constrainedPan);
      }
    }
  }, [zoom, imageConstraints, pan, constrainPan, onPanChange]);

  const handleUpload = async () => {
    if (!imageElement) return;
    const croppedUrl = await cropImage(imageElement, crop, zoom, pan);
    if (croppedUrl) {
      onUpload(croppedUrl);
    }
  };

  // Use constrained values for rendering (must be before any conditional returns)
  const constrainedPan = useMemo(() => constrainPan(pan), [pan, constrainPan]);
  const imageOffset = useMemo(() => {
    if (!imageConstraints) return { x: 0, y: 0 };
    return {
      x: (PREVIEW_SIZE - imageConstraints.zoomedWidth) / 2 + constrainedPan.x,
      y: (PREVIEW_SIZE - imageConstraints.zoomedHeight) / 2 + constrainedPan.y,
    };
  }, [imageConstraints, constrainedPan]);

  // Don't render modal if not open
  if (!isOpen) return null;

  // Show loading state if image isn't ready yet
  if (!imageElement || !imageSrc) {
    return (
      <Modal isOpen={isOpen} onClose={onClose} title="Preview & Adjust" size="md">
        <div className={styles.content}>
          <div style={{ textAlign: "center", padding: "2rem" }}>
            <p>Loading image...</p>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Preview & Adjust" size="md">
      <div className={styles.content}>
        <div className={styles.previewContainer}>
          <div
            className={styles.imageContainer}
            style={{ cursor: isDragging ? "grabbing" : "grab" }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          >
            <img
              src={imageSrc}
              alt="Preview"
              draggable={false}
              className={styles.previewImage}
              style={{
                left: `${imageOffset.x}px`,
                top: `${imageOffset.y}px`,
                width: `${imageConstraints.zoomedWidth}px`,
                height: `${imageConstraints.zoomedHeight}px`,
              }}
            />
            <div
              className={styles.cropOverlay}
              style={{
                left: `${crop.x}px`,
                top: `${crop.y}px`,
                width: `${crop.width}px`,
                height: `${crop.height}px`,
              }}
            />
          </div>
        </div>

        <div className={styles.controls}>
          <div className={styles.zoomControl}>
            <label className={styles.zoomLabel}>
              Zoom: <span className={styles.zoomValue}>{Math.round(zoom * 100)}%</span>
            </label>
            <input
              type="range"
              min={zoomBounds.min}
              max={zoomBounds.max}
              step="0.1"
              value={constrainZoom(zoom)}
              onChange={(e) => handleZoomChange(parseFloat(e.target.value))}
              className={styles.zoomSlider}
            />
          </div>
          <p className={styles.helpText}>Drag the image to adjust position. Use zoom to resize.</p>
          <div className={styles.actions}>
            <Button
              type="button"
              variant="primary"
              onClick={handleUpload}
              disabled={isUploading}
              fullWidth
            >
              {isUploading ? "Processing..." : "Upload Avatar"}
            </Button>
            <Button type="button" variant="outline" onClick={onClose} fullWidth>
              Cancel
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
});

AvatarPreviewModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  imageSrc: PropTypes.string.isRequired,
  imageElement: PropTypes.instanceOf(Image),
  crop: PropTypes.shape({
    x: PropTypes.number.isRequired,
    y: PropTypes.number.isRequired,
    width: PropTypes.number.isRequired,
    height: PropTypes.number.isRequired,
  }).isRequired,
  zoom: PropTypes.number.isRequired,
  pan: PropTypes.shape({
    x: PropTypes.number.isRequired,
    y: PropTypes.number.isRequired,
  }).isRequired,
  onZoomChange: PropTypes.func.isRequired,
  onPanChange: PropTypes.func.isRequired,
  onUpload: PropTypes.func.isRequired,
  isUploading: PropTypes.bool.isRequired,
};

export default AvatarPreviewModal;
