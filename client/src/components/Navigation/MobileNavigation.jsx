import React, { memo, useEffect, useCallback, useRef } from "react";
import {
  MonitorSmartphone,
  BarChart3,
  Menu,
  X,
  Home,
  Settings,
  Package,
  FileText,
  Sun,
  Moon,
  Shield,
  LogOut,
} from "lucide-react";
import PropTypes from "prop-types";
import { containerShape } from "../../utils/propTypes";
import { TAB_NAMES } from "../../constants/apiConstants";
import { useBodyScrollLock } from "../../hooks/useBodyScrollLock";
import styles from "./MobileNavigation.module.css";

/**
 * MobileNavigation component
 * Bottom navigation bar for mobile devices
 */
const MobileNavigation = ({
  activeTab,
  onTabChange,
  containersWithUpdates = [],
  trackedAppsBehind = 0,
  onMenuToggle,
  isMenuOpen,
  darkMode,
  instanceAdmin,
  onThemeToggle,
  onLogout,
}) => {
  // Lock body scroll when slide-out menu is open
  useBodyScrollLock(isMenuOpen);

  // Reference for the slide-out menu panel (focus trap)
  const menuRef = useRef(null);

  const closeMenu = useCallback(() => {
    if (typeof onMenuToggle === "function") {
      onMenuToggle(false);
    }
  }, [onMenuToggle]);

  const toggleMenu = useCallback(() => {
    if (typeof onMenuToggle === "function") {
      onMenuToggle(!isMenuOpen);
    }
  }, [onMenuToggle, isMenuOpen]);

  // Escape key closes the slide-out menu
  useEffect(() => {
    if (!isMenuOpen) return;

    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        closeMenu();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isMenuOpen, closeMenu]);

  // Focus the menu panel when it opens
  useEffect(() => {
    if (isMenuOpen && menuRef.current) {
      menuRef.current.focus();
    }
  }, [isMenuOpen]);

  const handleTabChange = useCallback(
    (tab) => {
      onTabChange(tab);
      closeMenu();
    },
    [onTabChange, closeMenu]
  );

  return (
    <>
      {/* Mobile Bottom Navigation */}
      <nav className={styles.mobileNav} aria-label="Main navigation">
        <button
          className={`${styles.navItem} ${activeTab === TAB_NAMES.SUMMARY ? styles.active : ""}`}
          onClick={() => handleTabChange(TAB_NAMES.SUMMARY)}
          aria-label="Summary"
          aria-current={activeTab === TAB_NAMES.SUMMARY ? "page" : undefined}
        >
          <Home size={20} aria-hidden="true" />
          <span className={styles.navLabel}>Summary</span>
        </button>

        <button
          className={`${styles.navItem} ${activeTab === TAB_NAMES.PORTAINER ? styles.active : ""}`}
          onClick={() => handleTabChange(TAB_NAMES.PORTAINER)}
          aria-label={`Portainer${containersWithUpdates.length > 0 ? `, ${containersWithUpdates.length} updates` : ""}`}
          aria-current={activeTab === TAB_NAMES.PORTAINER ? "page" : undefined}
        >
          <Package size={20} aria-hidden="true" />
          <span className={styles.navLabel}>Portainer</span>
          {containersWithUpdates.length > 0 && (
            <span className={styles.navBadge} aria-hidden="true">
              {containersWithUpdates.length}
            </span>
          )}
        </button>

        <button
          className={`${styles.navItem} ${activeTab === TAB_NAMES.TRACKED_APPS ? styles.active : ""}`}
          onClick={() => handleTabChange(TAB_NAMES.TRACKED_APPS)}
          aria-label={`Apps${trackedAppsBehind > 0 ? `, ${trackedAppsBehind} behind` : ""}`}
          aria-current={activeTab === TAB_NAMES.TRACKED_APPS ? "page" : undefined}
        >
          <MonitorSmartphone size={20} aria-hidden="true" />
          <span className={styles.navLabel}>Apps</span>
          {trackedAppsBehind > 0 && (
            <span className={styles.navBadge} aria-hidden="true">
              {trackedAppsBehind}
            </span>
          )}
        </button>

        <button
          className={`${styles.navItem} ${activeTab === TAB_NAMES.ANALYTICS ? styles.active : ""}`}
          onClick={() => handleTabChange(TAB_NAMES.ANALYTICS)}
          aria-label="Analytics"
          aria-current={activeTab === TAB_NAMES.ANALYTICS ? "page" : undefined}
        >
          <BarChart3 size={20} aria-hidden="true" />
          <span className={styles.navLabel}>Analytics</span>
        </button>

        <button
          className={styles.navItem}
          onClick={toggleMenu}
          aria-label={isMenuOpen ? "Close menu" : "Open menu"}
          aria-expanded={isMenuOpen}
          aria-controls="mobile-slide-menu"
        >
          {isMenuOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
          <span className={styles.navLabel}>Menu</span>
        </button>
      </nav>

      {/* Mobile Slide-out Menu */}
      {isMenuOpen && (
        <div className={styles.mobileMenuOverlay} onClick={closeMenu} aria-hidden="true">
          <nav
            id="mobile-slide-menu"
            ref={menuRef}
            className={styles.mobileMenu}
            onClick={(e) => e.stopPropagation()}
            role="navigation"
            aria-label="Secondary navigation"
            tabIndex={-1}
          >
            <div className={styles.mobileMenuHeader}>
              <h3>Menu</h3>
              <button className={styles.closeButton} onClick={closeMenu} aria-label="Close menu">
                <X size={24} aria-hidden="true" />
              </button>
            </div>
            <div className={styles.mobileMenuContent}>
              <button
                className={styles.menuItem}
                onClick={() => handleTabChange(TAB_NAMES.SUMMARY)}
              >
                <Home size={20} aria-hidden="true" />
                <span>Home</span>
              </button>

              <button
                className={styles.menuItem}
                onClick={() => handleTabChange(TAB_NAMES.BATCH_LOGS)}
              >
                <FileText size={20} aria-hidden="true" />
                <span>Batch</span>
              </button>

              <button
                className={styles.menuItem}
                onClick={() => handleTabChange(TAB_NAMES.SETTINGS)}
              >
                <Settings size={20} aria-hidden="true" />
                <span>Settings</span>
              </button>

              <button
                className={styles.menuItem}
                onClick={() => {
                  if (typeof onThemeToggle === "function") {
                    onThemeToggle();
                  }
                }}
              >
                {darkMode ? (
                  <Sun size={20} aria-hidden="true" />
                ) : (
                  <Moon size={20} aria-hidden="true" />
                )}
                <span>{darkMode ? "Light Mode" : "Dark Mode"}</span>
              </button>

              {instanceAdmin && (
                <button
                  className={styles.menuItem}
                  onClick={() => handleTabChange(TAB_NAMES.ADMIN)}
                >
                  <Shield size={20} aria-hidden="true" />
                  <span>Admin</span>
                </button>
              )}

              <div className={styles.menuDivider} />

              <button
                className={styles.menuItem}
                onClick={() => {
                  if (typeof onLogout === "function") {
                    onLogout();
                  }
                  closeMenu();
                }}
              >
                <LogOut size={20} aria-hidden="true" />
                <span>Logout</span>
              </button>
            </div>
          </nav>
        </div>
      )}
    </>
  );
};

MobileNavigation.propTypes = {
  activeTab: PropTypes.oneOf([
    TAB_NAMES.SUMMARY,
    TAB_NAMES.PORTAINER,
    TAB_NAMES.TRACKED_APPS,
    TAB_NAMES.INTENTS,
    TAB_NAMES.ANALYTICS,
    TAB_NAMES.SETTINGS,
    TAB_NAMES.CONFIGURATION,
    TAB_NAMES.BATCH_LOGS,
    TAB_NAMES.ADMIN,
  ]).isRequired,
  onTabChange: PropTypes.func.isRequired,
  containersWithUpdates: PropTypes.arrayOf(containerShape),
  trackedAppsBehind: PropTypes.number,
  onMenuToggle: PropTypes.func,
  isMenuOpen: PropTypes.bool,
  darkMode: PropTypes.bool,
  instanceAdmin: PropTypes.bool,
  onThemeToggle: PropTypes.func,
  onLogout: PropTypes.func,
};

export default memo(MobileNavigation);
