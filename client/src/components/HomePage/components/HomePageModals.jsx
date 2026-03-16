/**
 * HomePage modals component
 */

import React from "react";
import PropTypes from "prop-types";
import ErrorBoundary from "../../ErrorBoundary";
import AddSourceModal from "../../AddSourceModal";

/**
 * HomePage modals component
 * @param {Object} props
 * @param {boolean} props.showAddSourceModal - Whether to show add source modal
 * @param {Object} props.editingSourceInstance - Editing source instance
 * @param {Function} props.closeModal - Close modal handler
 * @param {Function} props.handleModalSuccess - Modal success handler
 */
const HomePageModals = ({
  showAddSourceModal,
  editingSourceInstance,
  closeModal,
  handleModalSuccess,
}) => {
  return (
    <ErrorBoundary>
      <AddSourceModal
        isOpen={showAddSourceModal}
        onClose={closeModal}
        onSuccess={handleModalSuccess}
        initialData={editingSourceInstance}
        instanceId={editingSourceInstance?.id || null}
      />
    </ErrorBoundary>
  );
};

HomePageModals.propTypes = {
  showAddSourceModal: PropTypes.bool.isRequired,
  editingSourceInstance: PropTypes.object,
  closeModal: PropTypes.func.isRequired,
  handleModalSuccess: PropTypes.func.isRequired,
};

export default HomePageModals;
