import React from "react";
import PropTypes from "prop-types";
import Modal from "../../ui/Modal";
import Button from "../../ui/Button";
import { cropImage } from "./AvatarCropper";
import styles from "./AvatarPreviewModal.module.css";

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

  const handleMouseDown = (e) => {
    setIsDragging(true);
    setDragStart({
      x: e.clientX - pan.x,
      y: e.clientY - pan.y,
    });
  };

  const handleMouseMove = (e) => {
    if (isDragging) {
      onPanChange({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y,
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleUpload = async () => {
    if (!imageElement) return;
    const croppedUrl = await cropImage(imageElement, crop, zoom, pan);
    if (croppedUrl) {
      onUpload(croppedUrl);
    }
  };

  if (!imageElement) return null;

  const aspect = imageElement.width / imageElement.height;
  let displayedWidth, displayedHeight;
  if (aspect > 1) {
    displayedWidth = 400;
    displayedHeight = 400 / aspect;
  } else {
    displayedHeight = 400;
    displayedWidth = 400 * aspect;
  }
  const zoomedWidth = displayedWidth * zoom;
  const zoomedHeight = displayedHeight * zoom;
  const offsetX = (400 - zoomedWidth) / 2 + pan.x;
  const offsetY = (400 - zoomedHeight) / 2 + pan.y;

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
                left: `${offsetX}px`,
                top: `${offsetY}px`,
                width: `${zoomedWidth}px`,
                height: `${zoomedHeight}px`,
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
              min="0.5"
              max="2"
              step="0.1"
              value={zoom}
              onChange={(e) => onZoomChange(parseFloat(e.target.value))}
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
