/**
 * CreateIntentModal Component
 * Modal wrapper for creating/editing intents
 */

import React, { useState, useCallback } from "react";
import PropTypes from "prop-types";
import Modal from "../ui/Modal";
import IntentForm from "./IntentForm";

function CreateIntentModal({
  isOpen,
  onClose,
  onSubmit,
  initialData,
  containers = [],
  sourceInstances = [],
  runners = [],
}) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isEditing = !!initialData?.id;

  const handleSubmit = useCallback(
    async (formData) => {
      setIsSubmitting(true);
      try {
        const result = await onSubmit(formData);
        if (result?.success) {
          onClose();
          return result;
        }
        return result;
      } finally {
        setIsSubmitting(false);
      }
    },
    [onSubmit, onClose]
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isEditing ? "Edit Intent" : "Create Intent"}
      size="lg"
      fullScreenMobile
    >
      <IntentForm
        initialData={initialData}
        onSubmit={handleSubmit}
        onCancel={onClose}
        isSubmitting={isSubmitting}
        containers={containers}
        sourceInstances={sourceInstances}
        runners={runners}
      />
    </Modal>
  );
}

CreateIntentModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onSubmit: PropTypes.func.isRequired,
  initialData: PropTypes.object,
  containers: PropTypes.array,
  sourceInstances: PropTypes.array,
  runners: PropTypes.array,
};

export default CreateIntentModal;
