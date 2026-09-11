// Discord Identity Provider (PLAN D-002 wave 1)
import crypto from "crypto";
import {
  IIdentityProvider,
  ProviderUser,
  ProviderTokens,
  AuthorizationRequest,
  AuthorizationResponse,
  CallbackRequest,
} from "../identityProvider";

interface DiscordTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
}

interface DiscordUser {
  id: string;
  username: string;
  discriminator?: string;
  avatar: string | null;
  email?: string;
  verified?: boolean;
  global_name?: string;
}

export class DiscordProvider implements IIdentityProvider {
  readonly name = "discord";
  readonly displayName = "Discord";

  private get clientId() {
    return process.env.DISCORD_CLIENT_ID || "";
  }
  private get clientSecret() {
    return process.env.DISCORD_CLIENT_SECRET || "";
  }

  /** Redirect URI configured for this provider (env-driven). */
  getRedirectUri(): string {
    return process.env.DISCORD_REDIRECT_URI || "";
  }

  isEnabled(): boolean {
    return !!this.clientId && !!this.clientSecret && !!this.getRedirectUri();
  }

  getAuthorizationUrl(request: AuthorizationRequest): AuthorizationResponse {
    if (!this.isEnabled()) {
      throw new Error("Discord OAuth is not configured");
    }

    const state = crypto.randomBytes(16).toString("hex");
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: request.redirectUri,
      response_type: "code",
      scope: "identify email",
      state,
    });

    return {
      authorizationUrl: `https://discord.com/api/oauth2/authorize?${params.toString()}`,
      state,
    };
  }

  async handleCallback(
    request: CallbackRequest
  ): Promise<{ tokens: ProviderTokens; user: ProviderUser }> {
    if (!this.isEnabled()) {
      throw new Error("Discord OAuth is not configured");
    }

    const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: "authorization_code",
        code: request.code,
        redirect_uri: request.redirectUri,
      }),
    });

    if (!tokenResponse.ok) {
      const error = await tokenResponse.text();
      throw new Error(`Discord token exchange failed: ${error}`);
    }

    const tokenData = (await tokenResponse.json()) as DiscordTokenResponse;
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
    const userResponse = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!userResponse.ok) {
      const error = await userResponse.text();
      throw new Error(`Failed to fetch Discord user: ${error}`);
    }

    const discordUser = (await userResponse.json()) as DiscordUser;

    return {
      providerId: discordUser.id,
      email: discordUser.email,
      username: discordUser.username,
      displayName: discordUser.global_name || discordUser.username,
      avatar: discordUser.avatar
        ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png`
        : undefined,
      verified: discordUser.verified,
      metadata: { raw: discordUser },
    };
  }
}

import { identityProviders } from "../identityProvider";
identityProviders.register(new DiscordProvider());
