/**
 * Main server file
 * Sets up Express app and middleware
 */

const express = require("express");
const cors = require("cors");
const path = require("path");
const config = require("./config");
const routes = require("./routes");
const { errorHandler } = require("./middleware/errorHandler");

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files from React app (in production)
if (process.env.NODE_ENV === "production") {
  app.use(express.static(path.join(__dirname, "public")));
}

// Routes
app.use("/api", routes);

// Serve React app for all non-API routes (in production)
if (process.env.NODE_ENV === "production") {
  app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "public/index.html"));
  });
}

// Error handling middleware (must be last)
app.use(errorHandler);

// Start server
app.listen(config.port, () => {
  console.log(`Server running on port ${config.port}`);
  console.log(`Portainer URLs: ${config.portainer.urls.join(", ")}`);
  console.log(`Portainer Username: ${config.portainer.username}`);
  console.log(`Password length: ${config.portainer.password.length}`);
  console.log(
    `Password contains #: ${
      config.portainer.password.includes("#") ? "YES" : "NO"
    }`
  );
  if (config.portainer.password.length > 0) {
    console.log(`Password first char: ${config.portainer.password[0]}`);
    console.log(
      `Password last char: ${
        config.portainer.password[config.portainer.password.length - 1]
      }`
    );
  }
  // Docker Hub authentication is now managed through the Settings UI
  console.log(
    `Docker Hub authentication: Configure via Settings UI for higher rate limits`
  );
  console.log(`Cache TTL: 24 hours`);
});

module.exports = app;
