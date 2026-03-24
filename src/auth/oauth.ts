import * as crypto from "node:crypto";
import * as http from "node:http";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { exec } from "node:child_process";
import { configDir } from "../core/paths.js";

interface TokenData {
  access_token: string;
  refresh_token?: string;
  expires_at: number;
  id_token?: string;
}

interface OIDCEndpoints {
  authorization_endpoint: string;
  token_endpoint: string;
}

/**
 * OAuth2 authorization code flow with PKCE for CLI/MCP clients.
 *
 * On first run: opens the browser → user signs in via Entra → callback
 * captures the code → exchanges for tokens → caches to disk.
 *
 * On subsequent runs: uses cached token, refreshes if expired.
 */
export class OAuthClient {
  private clientId: string;
  private issuerUrl: string;
  private tokenCachePath: string;
  private cachedToken: TokenData | null = null;
  private endpoints: OIDCEndpoints | null = null;

  constructor(clientId: string, issuerUrl: string, cacheKey: string) {
    this.clientId = clientId;
    this.issuerUrl = issuerUrl.replace(/\/+$/, "");
    this.tokenCachePath = path.join(configDir(), "app-tokens", `${cacheKey}.json`);
  }

  /** Returns a valid token for Bearer auth, refreshing or re-authenticating as needed. */
  async getAccessToken(): Promise<string> {
    if (!this.cachedToken) {
      this.cachedToken = await this.loadCachedToken();
    }

    if (this.cachedToken) {
      // Still valid (with 60s buffer)
      if (this.cachedToken.expires_at > Date.now() / 1000 + 60) {
        return this.getBearerToken();
      }
      // Try refresh
      if (this.cachedToken.refresh_token) {
        try {
          await this.refreshToken(this.cachedToken.refresh_token);
          return this.getBearerToken();
        } catch {
          console.error("Token refresh failed, re-authenticating...");
        }
      }
    }

    // Full browser-based authorization
    await this.authorize();
    return this.getBearerToken();
  }

  /**
   * Prefer id_token for Bearer auth. Entra CIAM access tokens have
   * Microsoft Graph as the audience, which oauth2-proxy won't accept.
   * The id_token has the correct issuer and audience (our client ID).
   */
  private getBearerToken(): string {
    return this.cachedToken!.id_token ?? this.cachedToken!.access_token;
  }

  private async discoverEndpoints(): Promise<OIDCEndpoints> {
    if (this.endpoints) return this.endpoints;
    const res = await fetch(`${this.issuerUrl}/.well-known/openid-configuration`);
    if (!res.ok) throw new Error(`OIDC discovery failed: ${res.status}`);
    this.endpoints = (await res.json()) as OIDCEndpoints;
    return this.endpoints;
  }

  private async authorize(): Promise<void> {
    const endpoints = await this.discoverEndpoints();

    // PKCE
    const codeVerifier = crypto.randomBytes(32).toString("base64url");
    const codeChallenge = crypto
      .createHash("sha256")
      .update(codeVerifier)
      .digest("base64url");

    // Start a temporary callback server on a random port
    const { port, codePromise } = await this.startCallbackServer();
    const redirectUri = `http://localhost:${port}`;

    const params = new URLSearchParams({
      client_id: this.clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      scope: "openid email profile offline_access",
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });
    const authUrl = `${endpoints.authorization_endpoint}?${params}`;

    console.error("Opening browser for sign-in...");
    await this.openBrowser(authUrl);

    // Block until the user completes sign-in (or 120s timeout)
    const code = await codePromise;

    // Exchange authorization code for tokens
    const tokenRes = await fetch(endpoints.token_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.clientId,
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }),
    });

    if (!tokenRes.ok) {
      const body = await tokenRes.text();
      throw new Error(`Token exchange failed (${tokenRes.status}): ${body}`);
    }

    const data = (await tokenRes.json()) as Record<string, unknown>;
    this.cachedToken = {
      access_token: data.access_token as string,
      refresh_token: data.refresh_token as string | undefined,
      expires_at: Date.now() / 1000 + ((data.expires_in as number) ?? 3600),
      id_token: data.id_token as string | undefined,
    };

    await this.saveToken(this.cachedToken);
    console.error("Authenticated successfully.");
  }

  private async refreshToken(refreshToken: string): Promise<void> {
    const endpoints = await this.discoverEndpoints();
    const res = await fetch(endpoints.token_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.clientId,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });

    if (!res.ok) throw new Error(`Refresh failed: ${res.status}`);

    const data = (await res.json()) as Record<string, unknown>;
    this.cachedToken = {
      access_token: data.access_token as string,
      refresh_token: (data.refresh_token as string | undefined) ?? refreshToken,
      expires_at: Date.now() / 1000 + ((data.expires_in as number) ?? 3600),
      id_token: data.id_token as string | undefined,
    };

    await this.saveToken(this.cachedToken);
  }

  private startCallbackServer(): Promise<{
    port: number;
    codePromise: Promise<string>;
  }> {
    return new Promise((resolve) => {
      const server = http.createServer();

      const codePromise = new Promise<string>((resolveCode, rejectCode) => {
        const timeout = setTimeout(() => {
          server.close();
          rejectCode(new Error("Authentication timed out (120s)"));
        }, 120_000);

        server.on("request", (req, res) => {
          const url = new URL(req.url!, "http://localhost");
          const code = url.searchParams.get("code");
          const error = url.searchParams.get("error");
          const errorDesc = url.searchParams.get("error_description");

          if (error) {
            res.writeHead(200, { "Content-Type": "text/html" });
            res.end(
              "<html><body><h1>Authentication failed</h1><p>You can close this tab.</p></body></html>"
            );
            clearTimeout(timeout);
            server.close();
            rejectCode(new Error(`OAuth error: ${error} — ${errorDesc}`));
            return;
          }

          if (code) {
            res.writeHead(200, { "Content-Type": "text/html" });
            res.end(
              "<html><body><h1>Signed in to Backpack</h1><p>You can close this tab.</p></body></html>"
            );
            clearTimeout(timeout);
            server.close();
            resolveCode(code);
            return;
          }

          res.writeHead(400);
          res.end();
        });
      });

      server.listen(0, "127.0.0.1", () => {
        const addr = server.address() as { port: number };
        resolve({ port: addr.port, codePromise });
      });
    });
  }

  private openBrowser(url: string): Promise<void> {
    const cmd =
      process.platform === "darwin"
        ? "open"
        : process.platform === "win32"
          ? "start"
          : "xdg-open";
    return new Promise((resolve) => {
      exec(`${cmd} "${url}"`, (err) => {
        if (err) {
          console.error(`Could not open browser. Please visit:\n${url}`);
        }
        resolve();
      });
    });
  }

  private async loadCachedToken(): Promise<TokenData | null> {
    try {
      const raw = await fs.readFile(this.tokenCachePath, "utf-8");
      return JSON.parse(raw) as TokenData;
    } catch {
      return null;
    }
  }

  private async saveToken(token: TokenData): Promise<void> {
    await fs.mkdir(path.dirname(this.tokenCachePath), { recursive: true });
    await fs.writeFile(
      this.tokenCachePath,
      JSON.stringify(token, null, 2),
      "utf-8"
    );
  }
}
