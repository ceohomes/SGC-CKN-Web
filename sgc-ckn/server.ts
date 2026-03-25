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
    
    // Add timestamp to filename to ensure uniqueness and avoid SHA conflicts
    const timestamp = Date.now();
    const safeFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
    const path = `SGC-CKN/${timestamp}_${safeFileName}`;
    
    // Check if file exists to get SHA (though with timestamp it's unlikely to exist)
    let sha: string | undefined;
    try {
      // Add cache-busting query param to ensure we get the latest SHA
      const getRes = await fetch(`https://api.github.com/repos/${username}/${repo}/contents/${path}?t=${timestamp}`, {
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

// GitHub Delete API
app.post("/api/github/delete", async (req, res) => {
  const token = process.env.GITHUB_TOKEN;
  const username = process.env.GITHUB_USERNAME;
  const repo = process.env.GITHUB_REPO || "construction-reports";

  if (!token || !username) {
    return res.status(401).json({ error: "GitHub not configured" });
  }

  const { fileUrl } = req.body;
  if (!fileUrl) {
    return res.status(400).json({ error: "Missing file URL" });
  }

  try {
    let path = "";
    const decodedUrl = decodeURIComponent(fileUrl);
    
    if (decodedUrl.includes('raw.githubusercontent.com')) {
      const match = decodedUrl.match(/https:\/\/raw\.githubusercontent\.com\/[^\/]+\/[^\/]+\/[^\/]+\/(.+)/);
      if (match) path = match[1];
    } else if (decodedUrl.includes('github.com')) {
      const match = decodedUrl.match(/https:\/\/github\.com\/[^\/]+\/[^\/]+\/blob\/[^\/]+\/(.+)/);
      if (match) path = match[1];
    }

    if (!path) {
      throw new Error("Could not determine file path from URL");
    }

    // 1. Get the SHA of the file
    const getRes = await fetch(`https://api.github.com/repos/${username}/${repo}/contents/${path}`, {
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    if (!getRes.ok) {
      throw new Error(`Failed to get file info from GitHub: ${getRes.statusText}`);
    }

    const fileData = await getRes.json();
    const sha = fileData.sha;

    // 2. Delete the file
    const deleteRes = await fetch(`https://api.github.com/repos/${username}/${repo}/contents/${path}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: `Delete construction report: ${path}`,
        sha: sha
      })
    });

    if (!deleteRes.ok) {
      const errorData = await deleteRes.json();
      throw new Error(errorData.message || "GitHub delete failed");
    }

    res.json({ success: true });
  } catch (error: any) {
    console.error("GitHub delete error:", error);
    res.status(500).json({ error: error.message || "Delete failed" });
  }
});

// Proxy GitHub files
app.get("/api/proxy/github", async (req, res) => {
  const token = process.env.GITHUB_TOKEN;
  const fileUrl = req.query.url as string;

  if (!fileUrl) return res.status(400).json({ error: "Thiếu URL tệp." });

  try {
    let fetchUrl = fileUrl;
    
    // 1. Chuyển đổi github.com sang raw.githubusercontent.com
    if (fileUrl.includes('github.com') && fileUrl.includes('/blob/')) {
      fetchUrl = fileUrl.replace('github.com', 'raw.githubusercontent.com').replace('/blob/', '/');
    }
    
    // 2. Chuyển đổi raw sang API URL để hỗ trợ Auth cho Private Repo
    if (fetchUrl.includes('raw.githubusercontent.com')) {
      const match = fetchUrl.match(/https:\/\/raw\.githubusercontent\.com\/([^\/]+)\/([^\/]+)\/([^\/]+)\/(.+)/);
      if (match) {
        const [_, owner, repo, branch, path] = match;
        const encodedPath = path.split('/').map(s => encodeURIComponent(decodeURIComponent(s))).join('/');
        fetchUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}?ref=${branch}`;
      }
    }

    console.log(`[Proxy] Đ đang tải: ${fetchUrl} ${token ? '(có token)' : '(không có token)'}`);

    const headers: Record<string, string> = {
      'Accept': 'application/vnd.github.v3.raw'
    };

    if (token) {
      headers['Authorization'] = `token ${token.trim()}`;
    }

    const response = await fetch(fetchUrl, { headers });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Proxy] Lỗi GitHub (${response.status}):`, errorText);
      
      if (response.status === 401 || response.status === 404) {
        if (!token) {
          return res.status(401).send("[Proxy Error] GITHUB_TOKEN is missing. Please configure it in Settings > Secrets.");
        }
      }
      return res.status(response.status).send(`Không thể tải tệp từ GitHub: ${response.statusText}`);
    }

    const contentType = response.headers.get("content-type");
    const lowerUrl = fileUrl.toLowerCase();
    
    // Thiết lập Content-Type chuẩn để trình duyệt có thể render
    if (lowerUrl.endsWith('.pdf')) {
      res.setHeader("Content-Type", "application/pdf");
    } else if (lowerUrl.endsWith('.jpg') || lowerUrl.endsWith('.jpeg')) {
      res.setHeader("Content-Type", "image/jpeg");
    } else if (lowerUrl.endsWith('.png')) {
      res.setHeader("Content-Type", "image/png");
    } else if (lowerUrl.endsWith('.webp')) {
      res.setHeader("Content-Type", "image/webp");
    } else if (contentType) {
      res.setHeader("Content-Type", contentType);
    }

    // Cho phép hiển thị trong iframe và tránh bị ép tải xuống
    res.setHeader("Content-Disposition", "inline");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "public, max-age=3600");

    const buffer = await response.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (error: any) {
    console.error("[Proxy] Lỗi hệ thống:", error);
    res.status(500).send("Lỗi máy chủ nội bộ.");
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
