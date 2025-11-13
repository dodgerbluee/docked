import React from "react";
import PropTypes from "prop-types";
import styles from "./Card.module.css";

/**
 * Card Component
 * Reusable card container with consistent styling
 */
const Card = React.memo(function Card({
  children,
  variant = "default",
  padding = "md",
  className = "",
  ...props
}) {
  const variantClass = styles[variant] || styles.default;
  const paddingClass = styles[`padding${padding.charAt(0).toUpperCase() + padding.slice(1)}`] || styles.paddingMd;

  return (
    <div className={`${styles.card} ${variantClass} ${paddingClass} ${className}`} {...props}>
      {children}
    </div>
  );
});

Card.propTypes = {
  children: PropTypes.node.isRequired,
  variant: PropTypes.oneOf(["default", "secondary", "tertiary", "bordered"]),
  padding: PropTypes.oneOf(["none", "sm", "md", "lg", "xl"]),
  className: PropTypes.string,
};

export default Card;

