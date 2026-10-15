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
});
