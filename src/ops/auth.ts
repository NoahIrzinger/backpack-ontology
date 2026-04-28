import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { OAuthClient } from "../auth/oauth.js";
import { configDir } from "../core/paths.js";
export function getRelayUrl(): string {
    return process.env.BACKPACK_APP_URL || "https://app.backpackontology.com";
}
export function getClientId(): string {
    return process.env.BACKPACK_APP_CLIENT_ID || "2d84f4b4-0c8c-4eb5-8f26-4dabc7f07551";
}
export function getIssuerUrl(): string {
    return process.env.BACKPACK_APP_ISSUER_URL || "https://8522cad6-89da-465d-ad30-7c1ac03c52c7.ciamlogin.com/8522cad6-89da-465d-ad30-7c1ac03c52c7/v2.0";
}
export function assertSafeRelay(url: string): void {
    let parsed: URL;
    try {
        parsed = new URL(url);
    }
    catch {
        throw new Error(`invalid relay URL: ${url}`);
    }
    if (parsed.protocol === "https:")
        return;
    if (parsed.protocol === "http:" && (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "::1"))
        return;
    if (process.env.BACKPACK_INSECURE_RELAY === "1")
        return;
    throw new Error(`refusing to send credentials to ${url} (non-HTTPS). ` +
        `set BACKPACK_INSECURE_RELAY=1 to override (only do this for local dev).`);
}
function shareSettingsPath(): string {
    return path.join(configDir(), "extensions", "share", "settings.json");
}
function appTokenCachePath(): string {
    const cacheKey = crypto.createHash("sha256").update(getRelayUrl()).digest("hex").slice(0, 12);
    return path.join(configDir(), "app-tokens", `${cacheKey}.json`);
}
export async function resolveCloudToken(): Promise<string | null> {
    try {
        const raw = await fs.readFile(shareSettingsPath(), "utf8");
        const settings = JSON.parse(raw) as {
            relay_token?: unknown;
        };
        if (typeof settings.relay_token === "string" && !isJwtExpired(settings.relay_token)) {
            return settings.relay_token;
        }
    }
    catch { }
    try {
        const raw = await fs.readFile(appTokenCachePath(), "utf8");
        const cached = JSON.parse(raw) as {
            id_token?: string;
            access_token?: string;
            expires_at?: number;
        };
        const token = cached.id_token || cached.access_token;
        if (token && (!cached.expires_at || cached.expires_at * 1000 > Date.now())) {
            return token;
        }
    }
    catch { }
    return null;
}
function decodeJwtPayload(token: string): Record<string, unknown> | null {
    try {
        const parts = token.split(".");
        if (parts.length !== 3)
            return null;
        const decoded = JSON.parse(Buffer.from(parts[1], "base64url").toString());
        if (typeof decoded !== "object" || decoded === null || Array.isArray(decoded))
            return null;
        return decoded as Record<string, unknown>;
    }
    catch {
        return null;
    }
}
export function emailFromToken(token: string): string | undefined {
    const payload = decodeJwtPayload(token);
    if (!payload)
        return undefined;
    const email = payload.email ?? payload.preferred_username;
    return typeof email === "string" ? email : undefined;
}
function isJwtExpired(token: string): boolean {
    const payload = decodeJwtPayload(token);
    if (!payload)
        return true;
    if (typeof payload.exp !== "number")
        return false;
    return payload.exp * 1000 <= Date.now();
}
export async function login(): Promise<{
    token: string;
    email?: string;
}> {
    const cacheKey = crypto.createHash("sha256").update(getRelayUrl()).digest("hex").slice(0, 12);
    const oauth = new OAuthClient(getClientId(), getIssuerUrl(), cacheKey);
    const token = await oauth.getAccessToken();
    return { token, email: emailFromToken(token) };
}
export interface LogoutResult {
    cleared: number;
    errors: {
        path: string;
        reason: string;
    }[];
}
export async function logout(): Promise<LogoutResult> {
    const errors: {
        path: string;
        reason: string;
    }[] = [];
    let cleared = 0;
    const settingsPath = shareSettingsPath();
    try {
        const raw = await fs.readFile(settingsPath, "utf8");
        let settings: Record<string, unknown>;
        try {
            settings = JSON.parse(raw) as Record<string, unknown>;
        }
        catch (err) {
            errors.push({ path: settingsPath, reason: `corrupt JSON — token may still be present (${(err as Error).message})` });
            settings = {};
        }
        if ("relay_token" in settings) {
            delete settings.relay_token;
            try {
                await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), "utf8");
                cleared++;
            }
            catch (err) {
                errors.push({ path: settingsPath, reason: `write failed: ${(err as Error).message}` });
            }
        }
    }
    catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
            errors.push({ path: settingsPath, reason: (err as Error).message });
        }
    }
    const cachePath = appTokenCachePath();
    try {
        await fs.unlink(cachePath);
        cleared++;
    }
    catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
            errors.push({ path: cachePath, reason: (err as Error).message });
        }
    }
    return { cleared, errors };
}
export interface AuthStatus {
    authenticated: boolean;
    email?: string;
    endpoint: string;
}
export async function authStatus(): Promise<AuthStatus> {
    const token = await resolveCloudToken();
    return {
        authenticated: !!token,
        email: token ? emailFromToken(token) : undefined,
        endpoint: getRelayUrl(),
    };
}
