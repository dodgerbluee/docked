import React from "react";
import PropTypes from "prop-types";
import { Link2, Edit2, Trash2, MoreVertical } from "lucide-react";
import Card from "../../../ui/Card";
import Button from "../../../ui/Button";
import { getProviderIcon, getProviderLabel } from "../../../../utils/providerHelpers";
import styles from "./TokenCard.module.css";

/**
 * TokenCard Component
 * Modern card component for displaying repository access tokens
 */
const TokenCard = React.memo(function TokenCard({
  token,
  onAssociateImages,
  onEdit,
  onDelete,
  loading = false,
}) {
  const IconComponent = getProviderIcon(token.provider);
  const providerLabel = token.name || getProviderLabel(token.provider);
  const [showMenu, setShowMenu] = React.useState(false);

  return (
    <Card variant="default" padding="lg" className={styles.tokenCard}>
      <div className={styles.cardHeader}>
        <div className={styles.tokenInfo}>
          <div className={styles.iconWrapper}>
            <IconComponent size={24} className={styles.providerIcon} />
          </div>
          <div className={styles.tokenDetails}>
            <h4 className={styles.tokenName}>{providerLabel}</h4>
            <span className={styles.providerBadge}>{token.provider}</span>
          </div>
        </div>
        <div className={styles.menuContainer}>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowMenu(!showMenu)}
            className={styles.menuButton}
            icon={MoreVertical}
            aria-label="More options"
          />
          {showMenu && (
            <>
              <div className={styles.menuOverlay} onClick={() => setShowMenu(false)} />
              <div className={styles.menu}>
                <button
                  className={styles.menuItem}
                  onClick={() => {
                    onEdit();
                    setShowMenu(false);
                  }}
                >
                  <Edit2 size={16} />
                  <span>Edit Token</span>
                </button>
                <button
                  className={`${styles.menuItem} ${styles.menuItemDanger}`}
                  onClick={() => {
                    onDelete();
                    setShowMenu(false);
                  }}
                >
                  <Trash2 size={16} />
                  <span>Delete</span>
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <div className={styles.cardActions}>
        <Button
          variant="outline"
          size="sm"
          onClick={onAssociateImages}
          disabled={loading}
          icon={Link2}
          iconPosition="left"
          className={styles.associateButton}
        >
          Associate Images
        </Button>
      </div>
    </Card>
  );
});

TokenCard.propTypes = {
  token: PropTypes.shape({
    id: PropTypes.number.isRequired,
    name: PropTypes.string,
    provider: PropTypes.oneOf(["github", "gitlab"]).isRequired,
  }).isRequired,
  onAssociateImages: PropTypes.func.isRequired,
  onEdit: PropTypes.func.isRequired,
  onDelete: PropTypes.func.isRequired,
  loading: PropTypes.bool,
};

export default TokenCard;
