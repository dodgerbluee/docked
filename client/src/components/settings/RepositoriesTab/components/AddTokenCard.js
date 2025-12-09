import React from "react";
import PropTypes from "prop-types";
import { Plus } from "lucide-react";
import Card from "../../../ui/Card";
import styles from "./AddTokenCard.module.css";

/**
 * AddTokenCard Component
 * Card component for adding new repository access tokens
 */
const AddTokenCard = React.memo(function AddTokenCard({ onClick }) {
  return (
    <Card
      variant="default"
      padding="lg"
      className={styles.addTokenCard}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      aria-label="Add new repository access token"
    >
      <div className={styles.content}>
        <div className={styles.iconWrapper}>
          <Plus size={24} className={styles.plusIcon} />
        </div>
        <div className={styles.text}>
          <h4 className={styles.title}>Add Access Token</h4>
          <p className={styles.description}>
            Add a new GitHub or GitLab token to enable update checking
          </p>
        </div>
      </div>
    </Card>
  );
});

AddTokenCard.propTypes = {
  onClick: PropTypes.func.isRequired,
};

export default AddTokenCard;

