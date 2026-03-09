import express from "express";
import { createServer as createViteServer } from "vite";
import session from "express-session";
import * as msal from "@azure/msal-node";
import { Client } from "@microsoft/microsoft-graph-client";
import "isomorphic-fetch";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

// MSAL Configuration
const msalConfig = {
  auth: {
    clientId: process.env.MS_CLIENT_ID || "4afbbdd0-3c97-466b-99d3-70415fd20530",
    authority: "https://login.microsoftonline.com/common",
    clientSecret: process.env.MS_CLIENT_SECRET || "861545da-9d9e-4baa-afef-cbd3c1edbeb8",
  }
};

const pca = new msal.ConfidentialClientApplication(msalConfig);

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

// Auth Routes
app.get("/api/auth/onedrive/url", async (req, res) => {
  const authCodeUrlParameters = {
    scopes: ["user.read", "files.readwrite.all"],
    redirectUri: process.env.MS_REDIRECT_URI || "https://ais-dev-j3y3dzsggf3z2b6aw4ycg4-270809794219.asia-east1.run.app/api/auth/onedrive/callback",
  };

  try {
    const response = await pca.getAuthCodeUrl(authCodeUrlParameters);
    res.json({ url: response });
  } catch (error) {
    console.error(error);
    res.status(500).send("Error generating auth URL");
  }
});

app.get("/api/auth/onedrive/callback", async (req, res) => {
  const tokenRequest = {
    code: req.query.code as string,
    scopes: ["user.read", "files.readwrite.all"],
    redirectUri: process.env.MS_REDIRECT_URI || "https://ais-dev-j3y3dzsggf3z2b6aw4ycg4-270809794219.asia-east1.run.app/api/auth/onedrive/callback",
  };

  try {
    const response = await pca.acquireTokenByCode(tokenRequest);
    (req.session as any).msToken = response.accessToken;
    
    res.send(`
      <html>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'ONEDRIVE_AUTH_SUCCESS' }, '*');
              window.close();
            } else {
              window.location.href = '/';
            }
          </script>
          <p>OneDrive connected successfully. You can close this window.</p>
        </body>
      </html>
    `);
  } catch (error) {
    console.error(error);
    res.status(500).send("Error acquiring token");
  }
});

app.get("/api/auth/onedrive/status", (req, res) => {
  res.json({ connected: !!(req.session as any).msToken });
});

// OneDrive Upload API
app.post("/api/onedrive/upload", async (req, res) => {
  const token = (req.session as any).msToken;
  if (!token) {
    return res.status(401).json({ error: "OneDrive not connected" });
  }

  const { fileName, base64Data } = req.body;
  if (!fileName || !base64Data) {
    return res.status(400).json({ error: "Missing file data" });
  }

  try {
    const client = Client.init({
      authProvider: (done) => {
        done(null, token);
      },
    });

    // Convert base64 to buffer
    const buffer = Buffer.from(base64Data.split(',')[1], 'base64');

    // Upload to OneDrive (root folder for simplicity)
    const uploadPath = `/me/drive/root:/SGC-CKN/${fileName}:/content`;
    const uploadResult = await client.api(uploadPath).put(buffer);

    // Create a sharing link
    const shareResult = await client.api(`/me/drive/items/${uploadResult.id}/createLink`).post({
      type: "view",
      scope: "anonymous"
    });

    res.json({ 
      fileUrl: shareResult.link.webUrl,
      id: uploadResult.id
    });
  } catch (error: any) {
    console.error("OneDrive upload error:", error);
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
