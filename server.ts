import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  // JSON payload parser
  app.use(express.json());

  // Debug health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", time: new Date().toISOString() });
  });

  // Secure Proxy Endpoint for Google PageSpeed Insights API v5
  app.post("/api/analyze", async (req, res): Promise<any> => {
    try {
      let { url, strategy } = req.body;

      if (!url || typeof url !== "string") {
        return res.status(400).json({ error: "Please enter a valid website URL." });
      }

      // Prepend https:// if not supplied
      let targetUrl = url.trim();
      if (!/^https?:\/\//i.test(targetUrl)) {
        targetUrl = "https://" + targetUrl;
      }

      // Validate URL format
      try {
        new URL(targetUrl);
      } catch (err) {
        return res.status(400).json({ error: "The provided URL is invalid. Please double check and try again." });
      }

      // Set target strategy (mobile or desktop)
      const targetStrategy = strategy === "mobile" ? "mobile" : "desktop";

      // Select API Key from environment (checks PAGESPEED_API_KEY, GOOGLE_API_KEY, GEMINI_API_KEY)
      const apiKey = process.env.PAGESPEED_API_KEY || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
      
      // Build Google PageSpeed insights endpoint URL
      const googleApiUrl = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
      googleApiUrl.searchParams.append("url", targetUrl);
      googleApiUrl.searchParams.append("strategy", targetStrategy);
      
      // Standard PageSpeed categories requested
      googleApiUrl.searchParams.append("category", "performance");
      googleApiUrl.searchParams.append("category", "accessibility");
      googleApiUrl.searchParams.append("category", "best-practices");
      googleApiUrl.searchParams.append("category", "seo");

      // Append API key if provided and not placeholder
      if (apiKey && apiKey !== "MY_GEMINI_API_KEY" && apiKey !== "") {
        googleApiUrl.searchParams.append("key", apiKey);
      }

      console.log(`[Proxy] Analyzing URL: ${targetUrl} [${targetStrategy}]`);

      // Make request to PSI API with a generous timeout signal
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 90000); // 90 second timeout

      try {
        const response = await fetch(googleApiUrl.toString(), {
          method: "GET",
          headers: {
            "Accept": "application/json",
          },
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorResponse = await response.json().catch(() => ({}));
          const status = response.status;
          
          let friendlyError = "Google PageSpeed Insights was unable to audit this page.";
          if (status === 400) {
            friendlyError = "Google PageSpeed API reported an error (invalid URL or inaccessible page).";
          } else if (status === 429) {
            friendlyError = "Too many requests. Please check your API quota or retry in a moment.";
          } else if (status === 500) {
            friendlyError = "The Google audit server encountered an error processing this page.";
          }

          const errMsg = errorResponse?.error?.message || response.statusText || friendlyError;

          return res.status(status).json({
            error: errMsg,
            details: errorResponse?.error || null,
          });
        }

        const data = await response.json();
        return res.json(data);

      } catch (fetchErr: any) {
        clearTimeout(timeoutId);
        if (fetchErr.name === "AbortError") {
          return res.status(504).json({
            error: "The analysis timed out. Google PageSpeed API took longer than 90 seconds to respond.",
          });
        }
        throw fetchErr;
      }

    } catch (error: any) {
      console.error("[Proxy] Critical Error:", error);
      return res.status(500).json({
        error: "An unexpected error occurred while proxying your audit request.",
        details: error.message,
      });
    }
  });

  // Vite middleware for development; Static serve for production
  if (process.env.NODE_ENV !== "production") {
    console.log("[Server] Registering Vite development middleware...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log("[Server] Production static server activated.");
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`===============================================`);
    console.log(`🚀 PSI Audit Full-Stack Server Running on Port ${PORT}`);
    console.log(`🌍 URL: http://localhost:${PORT}`);
    console.log(`===============================================`);
  });
}

startServer();
