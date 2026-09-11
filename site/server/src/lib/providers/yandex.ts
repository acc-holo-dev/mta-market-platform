// Yandex ID Identity Provider (PLAN D-002 wave 1)
import crypto from "crypto";
import {
  IIdentityProvider,
  ProviderUser,
  ProviderTokens,
  AuthorizationRequest,
  AuthorizationResponse,
  CallbackRequest,
} from "../identityProvider";

interface YandexTokenResponse {
  access_token: string;
  token_type?: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

interface YandexUser {
  id: string;
  login: string;
  default_email?: string;
  display_name?: string;
  avatar?: { id: string };
}

export class YandexProvider implements IIdentityProvider {
  readonly name = "yandex";
  readonly displayName = "Yandex ID";

  private get clientId() {
    return process.env.YANDEX_CLIENT_ID || "";
  }
  private get clientSecret() {
    return process.env.YANDEX_CLIENT_SECRET || "";
  }

  /** Redirect URI configured for this provider (env-driven). */
  getRedirectUri(): string {
    return process.env.YANDEX_REDIRECT_URI || "";
  }

  isEnabled(): boolean {
    return !!this.clientId && !!this.clientSecret && !!this.getRedirectUri();
  }

  getAuthorizationUrl(request: AuthorizationRequest): AuthorizationResponse {
    if (!this.isEnabled()) {
      throw new Error("Yandex OAuth is not configured");
    }

    const state = crypto.randomBytes(16).toString("hex");
    const params = new URLSearchParams({
      response_type: "code",
      client_id: this.clientId,
      redirect_uri: request.redirectUri,
      state,
    });

    return {
      authorizationUrl: `https://oauth.yandex.ru/authorize?${params.toString()}`,
      state,
    };
  }

  async handleCallback(
    request: CallbackRequest
  ): Promise<{ tokens: ProviderTokens; user: ProviderUser }> {
    if (!this.isEnabled()) {
      throw new Error("Yandex OAuth is not configured");
    }

    const tokenResponse = await fetch("https://oauth.yandex.ru/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: request.code,
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }),
    });

    if (!tokenResponse.ok) {
      const error = await tokenResponse.text();
      throw new Error(`Yandex token exchange failed: ${error}`);
    }

    const tokenData = (await tokenResponse.json()) as YandexTokenResponse;
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
    // Yandex Login Info API: oauth_token query param (Bearer also accepted).
    const userResponse = await fetch(
      `https://login.yandex.ru/info?format=json&oauth_token=${encodeURIComponent(accessToken)}`
    );

    if (!userResponse.ok) {
      const error = await userResponse.text();
      throw new Error(`Failed to fetch Yandex user: ${error}`);
    }

    const yandexUser = (await userResponse.json()) as YandexUser;

    // Yandex gives no verified-email flag on this endpoint.
    return {
      providerId: yandexUser.id,
      email: yandexUser.default_email ?? `${yandexUser.id}@yandex.local`,
      username: yandexUser.login,
      displayName: yandexUser.display_name || yandexUser.login,
      avatar: undefined,
      verified: false,
      metadata: { raw: yandexUser },
    };
  }
}

import { identityProviders } from "../identityProvider";
identityProviders.register(new YandexProvider());
