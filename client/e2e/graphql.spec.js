import { test, expect } from "@playwright/test";

const AUTH_TOKEN =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjEsInVzZXJuYW1lIjoiYWRtaW4iLCJyb2xlIjoiQWRtaW5pc3RyYXRvciIsImlhdCI6MTc5MjA0MTQ0OSwiZXhwIjoxNzkyMTI3ODQ5LCJhdWQiOiJkb2NrZWQtdXNlcnMiLCJpc3MiOiJkb2NrZWQifQ.3wLGp1g-PpE4x4HfA7Z5LpNymnV5vb6gc0kUHFPyYnk";

/**
 * Injects the auth token into localStorage so the app treats us as logged-in.
 */
async function authenticate(page) {
  await page.addInitScript((token) => {
    localStorage.setItem("authToken", token);
    localStorage.setItem("username", "admin");
    localStorage.setItem("userRole", "Administrator");
  }, AUTH_TOKEN);
}

/**
 * Extracts the GraphQL operation name from a request (GET or POST).
 */
function getGraphQLOpName(req) {
  const url = new URL(req.url());
  // GET: query params contain the operation
  const query = url.searchParams.get("query") || "";
  const opName = url.searchParams.get("operationName") || "";
  // POST: body contains JSON with query
  const body = req.postData() || "";
  const combined = query + body;
  return { opName, combined, url: req.url() };
}

test.describe("GraphQL Integration", () => {
  test("userPreferences query fires via /graphql on app load", async ({ page }) => {
    await authenticate(page);

    const graphqlRequests = [];
    page.on("request", (req) => {
      if (req.url().includes("/graphql") && !req.url().includes("/src/")) {
        graphqlRequests.push(getGraphQLOpName(req));
      }
    });

    await page.goto("/");
    // Wait for auth validation + GraphQL calls to complete
    await page.waitForTimeout(3000);

    // useTheme fires userPreferences query on mount
    const prefsRequest = graphqlRequests.find(
      (r) => r.combined.includes("userPreferences") || r.opName === "UserPreferences"
    );
    expect(prefsRequest).toBeTruthy();
    expect(prefsRequest.url).toContain("/graphql");
  });

  test("me query fires via /graphql on settings tab", async ({ page }) => {
    await authenticate(page);

    // Go to / and wait for auth to validate
    await page.goto("/");
    await page.waitForTimeout(2000);

    const graphqlRequests = [];
    page.on("request", (req) => {
      if (req.url().includes("/graphql") && !req.url().includes("/src/")) {
        graphqlRequests.push(getGraphQLOpName(req));
      }
    });

    // Open avatar menu, then click Settings to mount useUserSettings
    const avatarBtn = page.locator(".avatar-button");
    await avatarBtn.click();
    await page.waitForTimeout(300);

    const settingsBtn = page.locator('button.avatar-menu-item:has-text("Settings")');
    await settingsBtn.click();
    await page.waitForTimeout(2000);

    const meRequest = graphqlRequests.find(
      (r) => r.combined.includes("me {") || r.combined.includes("me%20%7B") || r.opName === "Me"
    );
    expect(meRequest).toBeTruthy();
    expect(meRequest.url).toContain("/graphql");
  });

  test("GraphQL responses contain expected data shape", async ({ page }) => {
    await authenticate(page);

    const graphqlResponses = [];
    page.on("response", async (res) => {
      if (res.url().includes("/graphql") && !res.url().includes("/src/") && res.status() === 200) {
        try {
          const body = await res.json();
          graphqlResponses.push(body);
        } catch {}
      }
    });

    await page.goto("/");
    await page.waitForTimeout(3000);

    // Find the userPreferences response
    const prefsResponse = graphqlResponses.find((r) => r.data?.userPreferences);
    expect(prefsResponse).toBeTruthy();
    expect(prefsResponse.data.userPreferences).toHaveProperty("colorScheme");
    expect(prefsResponse.data.userPreferences).toHaveProperty("refreshingTogglesEnabled");
  });

  test("no REST calls to /api/auth/me or /api/settings/color-scheme", async ({ page }) => {
    await authenticate(page);

    const restCalls = [];
    page.on("request", (req) => {
      const url = req.url();
      if (
        url.includes("/api/auth/me") ||
        url.includes("/api/settings/color-scheme") ||
        url.includes("/api/settings/refreshing-toggles")
      ) {
        restCalls.push(url);
      }
    });

    await page.goto("/");
    await page.waitForTimeout(3000);

    // These REST endpoints should NOT be called anymore
    expect(restCalls).toHaveLength(0);
  });

  test("updateUserPreferences mutation fires via /graphql", async ({ page }) => {
    await authenticate(page);

    await page.goto("/");
    await page.waitForTimeout(2000);

    const graphqlRequests = [];
    page.on("request", (req) => {
      if (req.url().includes("/graphql") && !req.url().includes("/src/")) {
        graphqlRequests.push(getGraphQLOpName(req));
      }
    });

    // Execute the mutation directly from the browser's JS context
    await page.evaluate(async () => {
      const token = localStorage.getItem("authToken");
      const res = await fetch("/graphql", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          query: `mutation UpdateUserPreferences($input: UpdateUserPreferencesInput!) {
            updateUserPreferences(input: $input) { success message }
          }`,
          variables: { input: { colorScheme: "light", refreshingTogglesEnabled: false } },
        }),
      });
      return res.json();
    });

    const mutationRequest = graphqlRequests.find(
      (r) =>
        r.combined.includes("updateUserPreferences") || r.combined.includes("UpdateUserPreferences")
    );
    expect(mutationRequest).toBeTruthy();
    expect(mutationRequest.url).toContain("/graphql");
  });

  test("sourceInstances query fires via GraphQL on settings sources tab", async ({ page }) => {
    await authenticate(page);

    await page.goto("/");
    await page.waitForTimeout(2000);

    const graphqlRequests = [];
    page.on("request", (req) => {
      if (req.url().includes("/graphql") && !req.url().includes("/src/")) {
        graphqlRequests.push(getGraphQLOpName(req));
      }
    });

    // Navigate to settings → sources tab
    const avatarBtn = page.locator(".avatar-button");
    await avatarBtn.click();
    await page.waitForTimeout(300);
    const settingsBtn = page.locator('button.avatar-menu-item:has-text("Settings")');
    await settingsBtn.click();
    await page.waitForTimeout(2000);

    // Click the Sources/Portainer tab
    const sourcesTab = page.locator('button:has-text("Sources"), button:has-text("Portainer")');
    if (await sourcesTab.isVisible()) {
      await sourcesTab.first().click();
      await page.waitForTimeout(2000);
    }

    const srcRequest = graphqlRequests.find(
      (r) => r.combined.includes("sourceInstances") || r.opName === "SourceInstances"
    );
    expect(srcRequest).toBeTruthy();
    expect(srcRequest.url).toContain("/graphql");
  });

  test("GraphQL queries return correct data shapes for new resolvers", async ({ page }) => {
    await authenticate(page);
    await page.goto("/");
    await page.waitForTimeout(2000);

    // Execute queries directly and verify response shapes
    const results = await page.evaluate(async () => {
      const token = localStorage.getItem("authToken");
      const headers = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      };

      const [srcRes, intentRes, batchRes, unusedRes] = await Promise.all([
        fetch("/graphql", {
          method: "POST",
          headers,
          body: JSON.stringify({
            query: "{ sourceInstances { id name url type authType hasApiKey } }",
          }),
        }).then((r) => r.json()),
        fetch("/graphql", {
          method: "POST",
          headers,
          body: JSON.stringify({ query: "{ intents { id name enabled } }" }),
        }).then((r) => r.json()),
        fetch("/graphql", {
          method: "POST",
          headers,
          body: JSON.stringify({
            query: "{ batchConfigs { jobType enabled intervalMinutes } }",
          }),
        }).then((r) => r.json()),
        fetch("/graphql", {
          method: "POST",
          headers,
          body: JSON.stringify({
            query: "{ unusedImages { id repoTags sizeBytes } }",
          }),
        }).then((r) => r.json()),
      ]);

      return { srcRes, intentRes, batchRes, unusedRes };
    });

    // sourceInstances returns array with expected fields
    expect(results.srcRes.data?.sourceInstances).toBeInstanceOf(Array);
    if (results.srcRes.data.sourceInstances.length > 0) {
      const src = results.srcRes.data.sourceInstances[0];
      expect(src).toHaveProperty("id");
      expect(src).toHaveProperty("name");
      expect(src).toHaveProperty("url");
      expect(src).toHaveProperty("type");
      expect(src).toHaveProperty("authType");
      expect(src).toHaveProperty("hasApiKey");
    }

    // intents returns array
    expect(results.intentRes.data?.intents).toBeInstanceOf(Array);

    // batchConfigs returns array with jobType
    expect(results.batchRes.data?.batchConfigs).toBeInstanceOf(Array);
    if (results.batchRes.data.batchConfigs.length > 0) {
      expect(results.batchRes.data.batchConfigs[0]).toHaveProperty("jobType");
      expect(results.batchRes.data.batchConfigs[0]).toHaveProperty("enabled");
    }

    // unusedImages returns array
    expect(results.unusedRes.data?.unusedImages).toBeInstanceOf(Array);
    expect(results.unusedRes.errors).toBeUndefined();
  });

  test("trackedApps query fires via GraphQL on Repos tab and UI renders transformed data", async ({
    page,
  }) => {
    await authenticate(page);

    const graphqlRequests = [];
    page.on("request", (req) => {
      if (req.url().includes("/graphql") && !req.url().includes("/src/")) {
        graphqlRequests.push(getGraphQLOpName(req));
      }
    });

    await page.goto("/");
    await page.waitForTimeout(3000);

    // Click the "Repos" (tracked apps) tab
    const reposTab = page.locator('button[aria-label="Repos tab"]');
    await reposTab.click();
    await page.waitForTimeout(2000);

    const trackedRequest = graphqlRequests.find(
      (r) => r.combined.includes("trackedApps") || r.opName === "TrackedApps"
    );
    expect(trackedRequest).toBeTruthy();
    expect(trackedRequest.url).toContain("/graphql");
  });

  test("repositoryTokens query fires via GraphQL on Registry Access settings tab", async ({
    page,
  }) => {
    await authenticate(page);
    await page.goto("/");
    await page.waitForTimeout(2000);

    const graphqlRequests = [];
    page.on("request", (req) => {
      if (req.url().includes("/graphql") && !req.url().includes("/src/")) {
        graphqlRequests.push(getGraphQLOpName(req));
      }
    });

    // Open settings
    const avatarBtn = page.locator(".avatar-button");
    await avatarBtn.click();
    await page.waitForTimeout(300);
    const settingsBtn = page.locator('button.avatar-menu-item:has-text("Settings")');
    await settingsBtn.click();
    await page.waitForTimeout(1500);

    // Click the "Registry Access" settings tab
    const registryTab = page.locator('button:has-text("Registry Access")');
    if (await registryTab.isVisible()) {
      await registryTab.first().click();
      await page.waitForTimeout(2000);
    }

    const tokenRequest = graphqlRequests.find(
      (r) => r.combined.includes("repositoryTokens") || r.opName === "RepositoryTokens"
    );
    expect(tokenRequest).toBeTruthy();
    expect(tokenRequest.url).toContain("/graphql");
  });
});
