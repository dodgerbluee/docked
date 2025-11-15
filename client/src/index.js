import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";

// Add scrollbar visibility on scroll
let scrollTimeout;
const handleScroll = () => {
  document.documentElement.classList.add("scrolling");
  clearTimeout(scrollTimeout);
  scrollTimeout = setTimeout(() => {
    document.documentElement.classList.remove("scrolling");
  }, 1000); // Keep visible for 1 second after scrolling stops
};

// Add scroll listener to show scrollbar when scrolling
if (typeof window !== "undefined") {
  window.addEventListener("scroll", handleScroll, { passive: true });
  // Also handle scroll on body/elements that might scroll
  window.addEventListener("wheel", handleScroll, { passive: true });
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
