// VK ID Identity Provider (PLAN-016 A-004)
// OAuth 2.0 against id.vk.com: authorize + code exchange (JSON body) +
// POST /oauth2/user_info. Mirrors the GoogleProvider structure.
import crypto from "crypto";
import {
  IIdentityProvider,
  ProviderUser,
  ProviderTokens,
  AuthorizationRequest,
  AuthorizationResponse,
  CallbackRequest,
} from "../identityProvider.js";

interface VkTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type?: string;
  scope?: string;
  user_id?: string | number;
}

interface VkUserInfoEntry {
  user_id: string | number;
  email?: string;
  phone?: string;
  first_name?: string;
  last_name?: string;
  avatar?: string;
  email_verified?: boolean;
}

interface VkUserInfoResponse {
  user?: VkUserInfoEntry[];
}

export class VkProvider implements IIdentityProvider {
  readonly name = "vk";
  readonly displayName = "VK ID";

  private get clientId() {
    return process.env.VK_CLIENT_ID || "";
  }
  private get clientSecret() {
    return process.env.VK_CLIENT_SECRET || "";
  }

  /** Redirect URI configured for this provider (env-driven). */
  getRedirectUri(): string {
    return process.env.VK_REDIRECT_URI || "";
  }

  isEnabled(): boolean {
    return !!this.clientId && !!this.clientSecret && !!this.getRedirectUri();
  }

  getAuthorizationUrl(request: AuthorizationRequest): AuthorizationResponse {
    if (!this.isEnabled()) {
      throw new Error("VK ID OAuth is not configured");
    }

    const state = crypto.randomBytes(16).toString("hex");
    const params = new URLSearchParams({
      response_type: "code",
      client_id: this.clientId,
      redirect_uri: request.redirectUri,
      state,
      scope: "email",
      v: "5.131",
    });

    return {
      authorizationUrl: `https://id.vk.com/authorize?${params.toString()}`,
      state,
    };
  }

  async handleCallback(
    request: CallbackRequest
  ): Promise<{ tokens: ProviderTokens; user: ProviderUser }> {
    if (!this.isEnabled()) {
      throw new Error("VK ID OAuth is not configured");
    }

    // VK ID token endpoint takes a JSON body (no PKCE: code_verifier stays
    // empty, matching the authorization request which sends no challenge).
    const tokenResponse = await providerFetch("https://id.vk.com/oauth2/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        code: request.code,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: request.redirectUri,
        state: request.state ?? "",
        code_verifier: "",
      }),
    });

    if (!tokenResponse.ok) {
      const error = await tokenResponse.text();
      throw new Error(`VK token exchange failed: ${error}`);
    }

    const tokenData = (await tokenResponse.json()) as VkTokenResponse;
    const user = await this.getUserInfo(tokenData.access_token);

    return {
      tokens: {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresIn: tokenData.expires_in,
        tokenType: tokenData.token_type,
        scope: tokenData.scope,
      },
      user,
    };
  }

  async getUserInfo(accessToken: string): Promise<ProviderUser> {
    const userResponse = await providerFetch("https://id.vk.com/oauth2/user_info", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!userResponse.ok) {
      const error = await userResponse.text();
      throw new Error(`Failed to fetch VK user: ${error}`);
    }

    const data = (await userResponse.json()) as VkUserInfoResponse;
    const entry = data.user?.[0];

    if (!entry) {
      throw new Error("VK user info response is empty");
    }

    const displayName =
      [entry.first_name, entry.last_name].filter(Boolean).join(" ") || undefined;

    return {
      providerId: String(entry.user_id),
      email: entry.email,
      // VK does not return a usable login here; the auth route builds a
      // conflict-free username from providerId.
      username: undefined,
      displayName,
      avatar: entry.avatar,
      verified: Boolean(entry.email_verified),
      metadata: { raw: data },
    };
  }
}

import { identityProviders } from "../identityProvider.js";
import { providerFetch } from "../providerHttp.js";
identityProviders.register(new VkProvider());
