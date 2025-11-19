/**
 * Portainer toolbar actions component
 */

import React, { useMemo } from "react";
import PropTypes from "prop-types";
import Button from "../../../components/ui/Button";
import { PORTAINER_CONTENT_TABS } from "../../../constants/portainerPage";
import styles from "../../PortainerPage.module.css";

/**
 * Portainer toolbar actions component
 * @param {Object} props
 * @param {string} props.contentTab - Current content tab
 * @param {Array} props.containersWithUpdates - Containers with updates
 * @param {Set} props.selectedContainers - Selected containers
 * @param {Set} props.selectedImages - Selected images
 * @param {Array} props.portainerUnusedImages - Unused images
 * @param {boolean} props.batchUpgrading - Whether batch upgrade is in progress
 * @param {boolean} props.deletingImages - Whether images are being deleted
 * @param {Function} props.onToggleSelect - Container selection toggle handler
 * @param {Function} props.onToggleImageSelect - Image selection toggle handler
 * @param {Function} props.onBatchUpgrade - Batch upgrade handler
 * @param {Function} props.onBatchDelete - Batch delete handler
 */
const PortainerToolbarActions = ({
  contentTab,
  containersWithUpdates,
  selectedContainers,
  selectedImages,
  portainerUnusedImages,
  batchUpgrading,
  deletingImages,
  onToggleSelect,
  onToggleImageSelect,
  onBatchUpgrade,
  onBatchDelete,
}) => {
  const toolbarActions = useMemo(() => {
    if (contentTab === PORTAINER_CONTENT_TABS.UPDATES && containersWithUpdates.length > 0) {
      const selectableContainersCount = containersWithUpdates.length;
      const allSelectableSelected =
        selectableContainersCount > 0 &&
        containersWithUpdates.every((c) => selectedContainers.has(c.id));

      return (
        <>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const allIds = containersWithUpdates.map((c) => c.id);
              const allSelected = allIds.every((id) => selectedContainers.has(id));
              if (allSelected) {
                allIds.forEach((id) => onToggleSelect(id));
              } else {
                allIds.forEach((id) => {
                  if (!selectedContainers.has(id)) {
                    onToggleSelect(id);
                  }
                });
              }
            }}
            disabled={batchUpgrading}
          >
            {allSelectableSelected ? "Unselect All" : "Select All"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onBatchUpgrade}
            disabled={selectedContainers.size === 0 || batchUpgrading}
          >
            {batchUpgrading
              ? `Upgrading ${selectedContainers.size}...`
              : `Upgrade Selected (${selectedContainers.size})`}
          </Button>
        </>
      );
    }

    if (contentTab === PORTAINER_CONTENT_TABS.UNUSED && portainerUnusedImages.length > 0) {
      const allImagesSelected =
        portainerUnusedImages.length > 0 &&
        portainerUnusedImages.every((img) => selectedImages.has(img.id));

      return (
        <>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const allIds = portainerUnusedImages.map((img) => img.id);
              const allSelected = allIds.every((id) => selectedImages.has(id));
              if (allSelected) {
                allIds.forEach((id) => onToggleImageSelect(id));
              } else {
                allIds.forEach((id) => {
                  if (!selectedImages.has(id)) {
                    onToggleImageSelect(id);
                  }
                });
              }
            }}
            disabled={deletingImages}
          >
            {allImagesSelected ? "Unselect All" : "Select All"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onBatchDelete}
            disabled={selectedImages.size === 0 || deletingImages}
            className={selectedImages.size > 0 ? styles.deleteButtonHover : ""}
          >
            {deletingImages
              ? `Deleting ${selectedImages.size}...`
              : `Delete Selected (${selectedImages.size})`}
          </Button>
        </>
      );
    }

    return null;
  }, [
    contentTab,
    containersWithUpdates,
    selectedContainers,
    selectedImages,
    portainerUnusedImages,
    batchUpgrading,
    deletingImages,
    onToggleSelect,
    onToggleImageSelect,
    onBatchUpgrade,
    onBatchDelete,
  ]);

  return toolbarActions;
};

PortainerToolbarActions.propTypes = {
  contentTab: PropTypes.string.isRequired,
  containersWithUpdates: PropTypes.array.isRequired,
  selectedContainers: PropTypes.instanceOf(Set).isRequired,
  selectedImages: PropTypes.instanceOf(Set).isRequired,
  portainerUnusedImages: PropTypes.array.isRequired,
  batchUpgrading: PropTypes.bool.isRequired,
  deletingImages: PropTypes.bool.isRequired,
  onToggleSelect: PropTypes.func.isRequired,
  onToggleImageSelect: PropTypes.func.isRequired,
  onBatchUpgrade: PropTypes.func.isRequired,
  onBatchDelete: PropTypes.func.isRequired,
};

export default PortainerToolbarActions;
