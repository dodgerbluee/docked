import React from "react";

/**
 * Custom whale icon component matching lucide-react style
 * Represents Docker/Portainer (Docker's logo is a whale)
 */
const WhaleIcon = ({ size = 18, ...props }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    {/* Whale icon - simple whale outline matching lucide-react style */}
    <path d="M3 13c0-4 3-7 6-7s6 3 6 7" />
    <path d="M15 13c0 4 3 7 6 7s6-3 6-7" />
    <path d="M9 6c0-1.5 1-2.5 2.5-2.5s2.5 1 2.5 2.5" />
    <circle cx="6.5" cy="12.5" r="1" fill="currentColor" />
    <path d="M3 13v4c0 1.5 1.5 2.5 3 2.5h1" />
    <path d="M21 13v4c0 1.5-1.5 2.5-3 2.5h-1" />
    <path d="M12 4v3" />
  </svg>
);

export default WhaleIcon;
