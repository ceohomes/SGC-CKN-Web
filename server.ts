import express from "express";
import { createServer as createViteServer } from "vite";
import session from "express-session";
import "isomorphic-fetch";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '50mb' }));
app.use(session({
  secret: "sgc-ckn-secret",
  resave: false,
  saveUninitialized: true,
  cookie: {
    secure: true,
    sameSite: 'none',
    httpOnly: true,
  }
}));

// GitHub Auth Status
app.get("/api/auth/github/status", async (req, res) => {
  const isConnected = !!(process.env.GITHUB_TOKEN && process.env.GITHUB_USERNAME);
  res.json({ connected: isConnected });
});

// GitHub Upload API
app.post("/api/github/upload", async (req, res) => {
  const token = process.env.GITHUB_TOKEN;
  const username = process.env.GITHUB_USERNAME;
  const repo = process.env.GITHUB_REPO || "construction-reports";

  if (!token || !username) {
    return res.status(401).json({ error: "GitHub not configured" });
  }

  const { fileName, base64Data } = req.body;
  if (!fileName || !base64Data) {
    return res.status(400).json({ error: "Missing file data" });
  }

  try {
    // Convert base64 to raw content (remove data:image/jpeg;base64, prefix)
    const content = base64Data.split(',')[1];
    const path = `SGC-CKN/${fileName}`;
    
    // Check if file exists to get SHA (for updates, though here we mostly create new)
    let sha: string | undefined;
    try {
      const getRes = await fetch(`https://api.github.com/repos/${username}/${repo}/contents/${path}`, {
        headers: {
          'Authorization': `token ${token}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      });
      if (getRes.ok) {
        const getData = await getRes.json();
        sha = getData.sha;
      }
    } catch (e) {
      // Ignore error if file doesn't exist
    }

    const uploadRes = await fetch(`https://api.github.com/repos/${username}/${repo}/contents/${path}`, {
      method: 'PUT',
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: `Upload construction report: ${fileName}`,
        content: content,
        sha: sha
      })
    });

    if (!uploadRes.ok) {
      const errorData = await uploadRes.json();
      throw new Error(errorData.message || "GitHub upload failed");
    }

    const uploadData = await uploadRes.json();
    
    // GitHub raw content URL or HTML URL
    // download_url is better for direct viewing if public, 
    // but html_url is the standard link.
    res.json({ 
      fileUrl: uploadData.content.download_url || uploadData.content.html_url,
      id: uploadData.content.sha
    });
  } catch (error: any) {
    console.error("GitHub upload error:", error);
    res.status(500).json({ error: error.message || "Upload failed" });
  }
});

// Proxy GitHub files
app.get("/api/proxy/github", async (req, res) => {
  const token = process.env.GITHUB_TOKEN;
  const fileUrl = req.query.url as string;

  if (!token) {
    console.error("Proxy Error: GITHUB_TOKEN is not configured in environment variables.");
    return res.status(401).json({ error: "GitHub token not configured. Please add GITHUB_TOKEN to Secrets." });
  }

  if (!fileUrl) {
    return res.status(400).json({ error: "Missing file URL" });
  }

  try {
    let fetchUrl = fileUrl;
    
    // 1. Convert standard github.com URLs to raw URLs
    if (fileUrl.includes('github.com') && fileUrl.includes('/blob/')) {
      fetchUrl = fileUrl.replace('github.com', 'raw.githubusercontent.com').replace('/blob/', '/');
    }
    
    // 2. Convert raw URL to API URL to support Private Repo Auth
    if (fetchUrl.includes('raw.githubusercontent.com')) {
      const match = fetchUrl.match(/https:\/\/raw\.githubusercontent\.com\/([^\/]+)\/([^\/]+)\/([^\/]+)\/(.+)/);
      if (match) {
        const [_, owner, repo, branch, path] = match;
        // Encode each segment of the path to handle spaces/special characters
        const encodedPath = path.split('/').map(segment => encodeURIComponent(decodeURIComponent(segment))).join('/');
        fetchUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}?ref=${branch}`;
      }
    }

    console.log(`[Proxy] Fetching: ${fetchUrl}`);

    const response = await fetch(fetchUrl, {
      headers: {
        'Authorization': `token ${token.trim()}`,
        'Accept': 'application/vnd.github.v3.raw'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Proxy] GitHub API error (${response.status}):`, errorText);
      return res.status(response.status).send(`GitHub Error: ${response.status}`);
    }

    // Forward content type and set security headers for iframe
    const contentType = response.headers.get("content-type");
    const lowerUrl = fileUrl.toLowerCase();
    
    if (lowerUrl.endsWith('.pdf')) {
      res.setHeader("Content-Type", "application/pdf");
    } else if (lowerUrl.endsWith('.jpg') || lowerUrl.endsWith('.jpeg')) {
      res.setHeader("Content-Type", "image/jpeg");
    } else if (lowerUrl.endsWith('.png')) {
      res.setHeader("Content-Type", "image/png");
    } else if (contentType) {
      res.setHeader("Content-Type", contentType);
    }

    res.setHeader("Content-Disposition", "inline");
    res.setHeader("X-Frame-Options", "ALLOWALL"); // Allow embedding in iframe

    const buffer = await response.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (error: any) {
    console.error("[Proxy] Internal Error:", error);
    res.status(500).send("Internal server error");
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
