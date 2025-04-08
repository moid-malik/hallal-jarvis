import { ConvexHttpClient } from "convex/browser";

// Cache the client instance
let cachedClient: ConvexHttpClient | null = null;

// Create a singleton instance of the Convex HTTP client with error handling
export const getConvexClient = () => {
  // Return cached client if available
  if (cachedClient) {
    return cachedClient;
  }

  // Check if the Convex URL is available
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) {
    console.error("Convex URL is not defined in environment variables");
    throw new Error("Convex URL is not configured");
  }

  try {
    // Create a new client instance
    cachedClient = new ConvexHttpClient(convexUrl);
    return cachedClient;
  } catch (error) {
    console.error("Failed to initialize Convex client:", error);
    throw new Error("Failed to initialize Convex client");
  }
};
