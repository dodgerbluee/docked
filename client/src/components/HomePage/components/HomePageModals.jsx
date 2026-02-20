/**
 * HomePage modals component
 */

import React from "react";
import PropTypes from "prop-types";
import ErrorBoundary from "../../ErrorBoundary";
import AddPortainerModal from "../../AddPortainerModal";

/**
 * HomePage modals component
 * @param {Object} props
 * @param {boolean} props.showAddPortainerModal - Whether to show add Portainer modal
 * @param {Object} props.editingPortainerInstance - Editing Portainer instance
 * @param {Function} props.closeModal - Close modal handler
 * @param {Function} props.handleModalSuccess - Modal success handler
 */
const HomePageModals = ({
  showAddPortainerModal,
  editingPortainerInstance,
  closeModal,
  handleModalSuccess,
}) => {
  return (
    <ErrorBoundary>
      <AddPortainerModal
        isOpen={showAddPortainerModal}
        onClose={closeModal}
        onSuccess={handleModalSuccess}
        initialData={editingPortainerInstance}
        instanceId={editingPortainerInstance?.id || null}
      />
    </ErrorBoundary>
  );
};

HomePageModals.propTypes = {
  showAddPortainerModal: PropTypes.bool.isRequired,
  editingPortainerInstance: PropTypes.object,
  closeModal: PropTypes.func.isRequired,
  handleModalSuccess: PropTypes.func.isRequired,
};

export default HomePageModals;
