/**
 * Containers toolbar actions component
 */

import React, { useMemo } from "react";
import PropTypes from "prop-types";
import Button from "../../../components/ui/Button";
import { CONTAINERS_CONTENT_TABS } from "../../../constants/containersPage";
import { getImageKey } from "../../../utils/imageHelpers";
import { getContainerKey } from "../../../utils/containerHelpers";
import styles from "../../ContainersPage.module.css";

/**
 * Containers toolbar actions component
 * @param {Object} props
 * @param {string} props.contentTab - Current content tab
 * @param {Array} props.containersWithUpdates - Containers with updates
 * @param {Set} props.selectedContainers - Selected containers
 * @param {Set} props.selectedImages - Selected images
 * @param {Array} props.sourceUnusedImages - Unused images
 * @param {boolean} props.deletingImages - Whether images are being deleted
 * @param {Function} props.onToggleSelect - Container selection toggle handler
 * @param {Function} props.onToggleImageSelect - Image selection toggle handler
 * @param {Function} props.onBatchUpgrade - Batch upgrade handler
 * @param {Function} props.onBatchDelete - Batch delete handler
 */
const ContainersToolbarActions = ({
  contentTab,
  containersWithUpdates,
  selectedContainers,
  selectedCount,
  selectedImages,
  sourceUnusedImages,
  deletingImages,
  onToggleSelect,
  onToggleImageSelect,
  onBatchUpgrade,
  onBatchDelete,
  compactLabels = false,
}) => {
  const toolbarActions = useMemo(() => {
    if (contentTab === CONTAINERS_CONTENT_TABS.UPDATES && containersWithUpdates.length > 0) {
      const selectableContainersCount = containersWithUpdates.length;
      const allSelectableSelected =
        selectableContainersCount > 0 &&
        containersWithUpdates.every((c) => selectedContainers.has(getContainerKey(c)));

      return (
        <>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const allIds = containersWithUpdates.map((c) => getContainerKey(c));
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
          >
            {allSelectableSelected
              ? compactLabels
                ? "None"
                : "Unselect All"
              : compactLabels
                ? "All"
                : "Select All"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onBatchUpgrade}
            disabled={selectedCount === 0}
          >
            {compactLabels ? `Upgrade (${selectedCount})` : `Upgrade Selected (${selectedCount})`}
          </Button>
        </>
      );
    }

    if (contentTab === CONTAINERS_CONTENT_TABS.UNUSED && sourceUnusedImages.length > 0) {
      const allImagesSelected =
        sourceUnusedImages.length > 0 &&
        sourceUnusedImages.every((img) => selectedImages.has(getImageKey(img)));
      // A delete request only ever carries images from the sources currently
      // shown, so the button has to count that intersection. Counting the whole
      // selection offered a number the click could not deliver whenever the
      // user had selected on one host and then filtered to another.
      const visibleSelectedCount = sourceUnusedImages.filter((img) =>
        selectedImages.has(getImageKey(img))
      ).length;

      return (
        <>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const allKeys = sourceUnusedImages.map((img) => getImageKey(img));
              const allSelected = allKeys.every((key) => selectedImages.has(key));
              if (allSelected) {
                allKeys.forEach((key) => onToggleImageSelect(key));
              } else {
                allKeys.forEach((key) => {
                  if (!selectedImages.has(key)) {
                    onToggleImageSelect(key);
                  }
                });
              }
            }}
            disabled={deletingImages}
          >
            {allImagesSelected
              ? compactLabels
                ? "None"
                : "Unselect All"
              : compactLabels
                ? "All"
                : "Select All"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onBatchDelete}
            disabled={visibleSelectedCount === 0 || deletingImages}
            className={visibleSelectedCount > 0 ? styles.deleteButtonHover : ""}
          >
            {deletingImages
              ? `Deleting ${visibleSelectedCount}...`
              : compactLabels
                ? `Delete (${visibleSelectedCount})`
                : `Delete Selected (${visibleSelectedCount})`}
          </Button>
        </>
      );
    }

    return null;
  }, [
    contentTab,
    containersWithUpdates,
    selectedContainers,
    selectedCount,
    selectedImages,
    sourceUnusedImages,
    deletingImages,
    onToggleSelect,
    onToggleImageSelect,
    onBatchUpgrade,
    onBatchDelete,
    compactLabels,
  ]);

  return toolbarActions;
};

ContainersToolbarActions.propTypes = {
  contentTab: PropTypes.string.isRequired,
  containersWithUpdates: PropTypes.array.isRequired,
  selectedContainers: PropTypes.instanceOf(Set).isRequired,
  selectedCount: PropTypes.number.isRequired,
  selectedImages: PropTypes.instanceOf(Set).isRequired,
  sourceUnusedImages: PropTypes.array.isRequired,
  deletingImages: PropTypes.bool.isRequired,
  onToggleSelect: PropTypes.func.isRequired,
  onToggleImageSelect: PropTypes.func.isRequired,
  onBatchUpgrade: PropTypes.func.isRequired,
  onBatchDelete: PropTypes.func.isRequired,
  compactLabels: PropTypes.bool,
};

export default ContainersToolbarActions;
