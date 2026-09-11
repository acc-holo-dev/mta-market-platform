// Google OpenID Connect Identity Provider (PLAN D-002 wave 1)
import crypto from "crypto";
import {
  IIdentityProvider,
  ProviderUser,
  ProviderTokens,
  AuthorizationRequest,
  AuthorizationResponse,
  CallbackRequest,
} from "../identityProvider";

interface GoogleTokenResponse {
  access_token: string;
  token_type?: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

interface GoogleUser {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
}

export class GoogleProvider implements IIdentityProvider {
  readonly name = "google";
  readonly displayName = "Google";

  private get clientId() {
    return process.env.GOOGLE_CLIENT_ID || "";
  }
  private get clientSecret() {
    return process.env.GOOGLE_CLIENT_SECRET || "";
  }

  /** Redirect URI configured for this provider (env-driven). */
  getRedirectUri(): string {
    return process.env.GOOGLE_REDIRECT_URI || "";
  }

  isEnabled(): boolean {
    return !!this.clientId && !!this.clientSecret && !!this.getRedirectUri();
  }

  getAuthorizationUrl(request: AuthorizationRequest): AuthorizationResponse {
    if (!this.isEnabled()) {
      throw new Error("Google OAuth is not configured");
    }

    const state = crypto.randomBytes(16).toString("hex");
    const params = new URLSearchParams({
      response_type: "code",
      scope: "openid email profile",
      access_type: "offline",
      include_granted_scopes: "true",
      client_id: this.clientId,
      redirect_uri: request.redirectUri,
      state,
    });

    return {
      authorizationUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
      state,
    };
  }

  async handleCallback(
    request: CallbackRequest
  ): Promise<{ tokens: ProviderTokens; user: ProviderUser }> {
    if (!this.isEnabled()) {
      throw new Error("Google OAuth is not configured");
    }

    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: request.code,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: "authorization_code",
        redirect_uri: request.redirectUri,
      }),
    });

    if (!tokenResponse.ok) {
      const error = await tokenResponse.text();
      throw new Error(`Google token exchange failed: ${error}`);
    }

    const tokenData = (await tokenResponse.json()) as GoogleTokenResponse;
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
    const userResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!userResponse.ok) {
      const error = await userResponse.text();
      throw new Error(`Failed to fetch Google user: ${error}`);
    }

    const googleUser = (await userResponse.json()) as GoogleUser;

    return {
      providerId: googleUser.sub,
      email: googleUser.email,
      username: googleUser.email?.split("@")[0] || googleUser.sub,
      displayName: googleUser.name,
      avatar: googleUser.picture,
      verified: googleUser.email_verified,
      metadata: { raw: googleUser },
    };
  }
}

import { identityProviders } from "../identityProvider";
identityProviders.register(new GoogleProvider());
