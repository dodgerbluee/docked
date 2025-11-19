/**
 * Hook for managing avatar crop, zoom, and pan state
 */

import { useState, useEffect } from "react";

/**
 * Hook to manage avatar crop, zoom, and pan state
 * @returns {Object} Avatar crop state and handlers
 */
export const useAvatarCrop = () => {
  const [avatarPreview, setAvatarPreview] = useState(null);
  const [avatarFile, setAvatarFile] = useState(null);
  const [avatarImage, setAvatarImage] = useState(null);
  const [avatarCrop, setAvatarCrop] = useState({
    x: 0,
    y: 0,
    width: 200,
    height: 200,
  });
  const [avatarZoom, setAvatarZoom] = useState(1);
  const [avatarPan, setAvatarPan] = useState({ x: 0, y: 0 });
  const [imageReady, setImageReady] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(false);

  // Open modal when image is ready
  useEffect(() => {
    if (avatarImage && avatarPreview && imageReady) {
      setShowPreviewModal(true);
      setImageReady(false); // Reset flag
    }
  }, [avatarImage, avatarPreview, imageReady]);

  const handleAvatarFileSelect = (file, onError) => {
    if (!file.type.startsWith("image/")) {
      if (onError) onError("Please select an image file");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      if (onError) onError("Image size must be less than 5MB");
      return;
    }

    setAvatarFile(file);
    setShowPreviewModal(false); // Reset modal state
    setImageReady(false); // Reset ready flag

    const reader = new FileReader();
    reader.onerror = () => {
      if (onError) onError("Failed to read file");
    };
    reader.onload = (e) => {
      const img = new window.Image(); // Use window.Image to avoid conflict with lucide-react Image
      img.onerror = () => {
        if (onError) onError("Failed to load image");
      };
      img.onload = () => {
        const previewSize = 400;
        const imageAspect = img.width / img.height;
        let displayedWidth, displayedHeight;
        if (imageAspect > 1) {
          displayedWidth = previewSize;
          displayedHeight = previewSize / imageAspect;
        } else {
          displayedHeight = previewSize;
          displayedWidth = previewSize * imageAspect;
        }

        const cropSize = Math.min(displayedWidth, displayedHeight);
        const cropX = (previewSize - cropSize) / 2;
        const cropY = (previewSize - cropSize) / 2;

        // Set all state at once, then trigger modal open via useEffect
        setAvatarImage(img);
        setAvatarPreview(e.target.result);
        setAvatarCrop({
          x: cropX,
          y: cropY,
          width: cropSize,
          height: cropSize,
        });
        setAvatarZoom(1);
        setAvatarPan({ x: 0, y: 0 });
        // Mark image as ready - useEffect will open modal
        setImageReady(true);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  };

  const resetAvatarState = () => {
    setShowPreviewModal(false);
    setImageReady(false);
    setAvatarPreview(null);
    setAvatarFile(null);
    setAvatarImage(null);
    setAvatarCrop({ x: 0, y: 0, width: 200, height: 200 });
    setAvatarZoom(1);
    setAvatarPan({ x: 0, y: 0 });
  };

  return {
    avatarPreview,
    avatarFile,
    avatarImage,
    avatarCrop,
    avatarZoom,
    avatarPan,
    showPreviewModal,
    setAvatarZoom,
    setAvatarPan,
    handleAvatarFileSelect,
    resetAvatarState,
  };
};
