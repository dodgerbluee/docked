import React from "react";
import PropTypes from "prop-types";
import styles from "./Button.module.css";

/**
 * Button Component
 * Reusable button with variants and consistent styling
 */
const Button = React.memo(function Button({
  children,
  variant = "primary",
  size = "md",
  type = "button",
  disabled = false,
  onClick,
  className = "",
  icon: Icon,
  iconPosition = "left",
  fullWidth = false,
  ...props
}) {
  const variantClass = styles[variant] || styles.primary;
  const sizeClass = styles[size] || styles.md;
  const fullWidthClass = fullWidth ? styles.fullWidth : "";

  return (
    <button
      type={type}
      className={`${styles.button} ${variantClass} ${sizeClass} ${fullWidthClass} ${className}`}
      disabled={disabled}
      onClick={onClick}
      {...props}
    >
      {Icon && iconPosition === "left" && (
        <Icon size={size === "sm" ? 14 : size === "lg" ? 20 : 16} className={styles.iconLeft} />
      )}
      {children}
      {Icon && iconPosition === "right" && (
        <Icon size={size === "sm" ? 14 : size === "lg" ? 20 : 16} className={styles.iconRight} />
      )}
    </button>
  );
});

Button.propTypes = {
  children: PropTypes.node.isRequired,
  variant: PropTypes.oneOf(["primary", "secondary", "danger", "ghost", "outline"]),
  size: PropTypes.oneOf(["sm", "md", "lg"]),
  type: PropTypes.oneOf(["button", "submit", "reset"]),
  disabled: PropTypes.bool,
  onClick: PropTypes.func,
  className: PropTypes.string,
  icon: PropTypes.elementType,
  iconPosition: PropTypes.oneOf(["left", "right"]),
  fullWidth: PropTypes.bool,
};

export default Button;
