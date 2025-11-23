# Middleware Documentation

## Available Middleware

### errorHandler
Global error handling middleware that recognizes custom error classes and formats responses consistently.

**Location:** `server/middleware/errorHandler.js`

**Usage:**
```javascript
const { errorHandler, asyncHandler } = require("./middleware/errorHandler");

// Apply to app (must be last)
app.use(errorHandler);

// Wrap async route handlers
router.get("/endpoint", asyncHandler(async (req, res) => {
  // Your route handler
}));
```

**Custom Errors Supported:**
- `ValidationError` - 400 Bad Request
- `NotFoundError` - 404 Not Found
- `UnauthorizedError` - 401 Unauthorized
- `ForbiddenError` - 403 Forbidden
- `ConflictError` - 409 Conflict
- `RateLimitExceededError` - 429 Too Many Requests

### responseFormatter
Ensures all API responses follow a consistent format with `success` field.

**Location:** `server/middleware/responseFormatter.js`

**Usage:**
```javascript
const responseFormatter = require("./middleware/responseFormatter");

// Apply early in middleware chain (after body parsing)
app.use(responseFormatter);
```

**Behavior:**
- Automatically wraps success responses (2xx) with `{ success: true, ...data }`
- Automatically wraps error responses (4xx, 5xx) with `{ success: false, error: ... }`
- If response already has `success` field, leaves it unchanged

### validation
Provides reusable validation middleware using express-validator.

**Location:** `server/middleware/validation.js`

**Usage:**
```javascript
const { validate, validationChains } = require("./middleware/validation");

// Use pre-built validation chain
router.post(
  "/containers/:containerId/upgrade",
  validate(validationChains.containerUpgrade),
  asyncHandler(containerController.upgradeContainer)
);

// Create custom validation
router.post(
  "/custom-endpoint",
  validate([
    body("field1").isString().notEmpty(),
    body("field2").isEmail(),
  ]),
  asyncHandler(controller.handler)
);
```

**Pre-built Validation Chains:**
- `validationChains.containerUpgrade` - Container upgrade validation
- `validationChains.portainerInstance` - Portainer instance validation
- `validationChains.user` - User creation/update validation
- `validationChains.pagination` - Pagination query parameters

**Common Validations:**
- `commonValidations.containerId` - Container ID param
- `commonValidations.endpointId` - Endpoint ID body field
- `commonValidations.imageName` - Image name validation
- `commonValidations.portainerUrl` - Portainer URL validation
- `commonValidations.username` - Username validation
- `commonValidations.password` - Password validation
- `commonValidations.page` - Pagination page query
- `commonValidations.limit` - Pagination limit query

## Example: Complete Route with Validation

```javascript
const express = require("express");
const { asyncHandler } = require("../middleware/errorHandler");
const { validate, validationChains } = require("../middleware/validation");
const { sendSuccessResponse } = require("../utils/responseHelpers");
const { NotFoundError } = require("../utils/errors");

const router = express.Router();

router.post(
  "/containers/:containerId/upgrade",
  validate(validationChains.containerUpgrade),
  asyncHandler(async (req, res) => {
    const { containerId } = req.params;
    const { endpointId, imageName, portainerUrl } = req.body;
    
    const result = await containerService.upgradeContainer(
      portainerUrl,
      endpointId,
      containerId,
      imageName
    );
    
    if (!result) {
      throw new NotFoundError("Container");
    }
    
    sendSuccessResponse(res, result, "Container upgraded successfully");
  })
);

module.exports = router;
```

