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
    // raw.githubusercontent.com is better for direct viewing if public, 
    // but html_url is the standard link.
    res.json({ 
      fileUrl: uploadData.content.html_url,
      id: uploadData.content.sha
    });
  } catch (error: any) {
    console.error("GitHub upload error:", error);
    res.status(500).json({ error: error.message || "Upload failed" });
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
