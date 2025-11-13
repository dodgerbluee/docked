/**
 * AvatarCropper Utility
 * Handles image cropping logic
 */

/**
 * Crops an image based on crop area, zoom, and pan settings
 * @param {HTMLImageElement} image - The source image element
 * @param {Object} crop - Crop area {x, y, width, height}
 * @param {number} zoom - Zoom level
 * @param {Object} pan - Pan offset {x, y}
 * @param {number} previewSize - Preview container size (default 400)
 * @returns {Promise<string>} Blob URL of cropped image
 */
export const cropImage = (image, crop, zoom, pan, previewSize = 400) => {
  return new Promise((resolve) => {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    const imageAspect = image.width / image.height;
    let displayedWidth, displayedHeight;
    if (imageAspect > 1) {
      displayedWidth = previewSize;
      displayedHeight = previewSize / imageAspect;
    } else {
      displayedHeight = previewSize;
      displayedWidth = previewSize * imageAspect;
    }

    const zoomedWidth = displayedWidth * zoom;
    const zoomedHeight = displayedHeight * zoom;

    const offsetX = (previewSize - zoomedWidth) / 2;
    const offsetY = (previewSize - zoomedHeight) / 2;

    const cropXInPreview = crop.x;
    const cropYInPreview = crop.y;
    const cropSizeInPreview = crop.width;

    const cropXAdjusted = cropXInPreview - offsetX - (pan?.x || 0);
    const cropYAdjusted = cropYInPreview - offsetY - (pan?.y || 0);

    const scaleToImage = image.width / zoomedWidth;
    const sourceX = Math.max(0, cropXAdjusted * scaleToImage);
    const sourceY = Math.max(0, cropYAdjusted * scaleToImage);
    const sourceSize = Math.min(
      cropSizeInPreview * scaleToImage,
      image.width - sourceX,
      image.height - sourceY,
      Math.min(image.width, image.height)
    );

    const outputSize = 128;
    canvas.width = outputSize;
    canvas.height = outputSize;

    ctx.drawImage(
      image,
      sourceX,
      sourceY,
      sourceSize,
      sourceSize,
      0,
      0,
      outputSize,
      outputSize
    );

    canvas.toBlob(
      (blob) => {
        if (!blob) {
          resolve(null);
          return;
        }
        const url = URL.createObjectURL(blob);
        resolve(url);
      },
      "image/jpeg",
      0.85
    );
  });
};

