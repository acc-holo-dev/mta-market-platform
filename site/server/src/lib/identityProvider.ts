// Identity Provider Interface
// Abstraction layer for OAuth/OIDC providers (Discord, Telegram, Yandex, Google, etc.)

export interface ProviderUser {
  providerId: string; // Provider's user ID (unique per provider)
  email?: string; // User's email (may not be available)
  username?: string; // Display username
  displayName?: string; // Full display name
  avatar?: string; // Avatar URL
  verified?: boolean; // Email verified flag
  metadata?: Record<string, any>; // Provider-specific data
}

export interface ProviderTokens {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number; // Seconds until access token expires
  tokenType?: string; // Usually "Bearer"
  scope?: string;
}

export interface AuthorizationRequest {
  redirectUri: string;
  state?: string; // CSRF protection token
  scopes?: string[]; // Requested scopes
}

export interface AuthorizationResponse {
  authorizationUrl: string; // URL to redirect user to
  state?: string; // CSRF token to verify in callback
}

export interface CallbackRequest {
  code: string; // Authorization code from provider
  state?: string; // CSRF token verification
  redirectUri: string;
}

/**
 * Identity Provider Interface
 * 
 * Implementations:
 * - DiscordProvider (Discord OAuth2)
 * - TelegramProvider (Telegram Login Widget / Bot API)
 * - YandexProvider (Yandex ID / OAuth)
 * - GoogleProvider (Google OpenID Connect)
 * - AppleProvider (Sign in with Apple)
 * - SberProvider (Sber ID)
 */
export interface IIdentityProvider {
  /**
   * Provider name for identification
   * Examples: "discord", "telegram", "yandex", "google"
   */
  readonly name: string;

  /**
   * Human-readable provider display name
   * Examples: "Discord", "Telegram", "Яндекс ID"
   */
  readonly displayName: string;

  /**
   * Check if provider is enabled and configured
   */
  isEnabled(): boolean;

  /**
   * OAuth redirect URI configured for this provider (env-driven).
   * Used both when building the authorize URL and when exchanging the code.
   */
  getRedirectUri(): string;

  /**
   * Get authorization URL to redirect user to
   * 
   * @param request - Authorization parameters
   * @returns URL to redirect user to provider's login page
   */
  getAuthorizationUrl(request: AuthorizationRequest): AuthorizationResponse;

  /**
   * Exchange authorization code for access token
   * 
   * @param request - Callback parameters (code, state)
   * @returns Access token and user info
   */
  handleCallback(request: CallbackRequest): Promise<{
    tokens: ProviderTokens;
    user: ProviderUser;
  }>;

  /**
   * Fetch user info using access token
   * Used for account updates or re-verification
   * 
   * @param accessToken - Valid access token
   * @returns Current user information
   */
  getUserInfo(accessToken: string): Promise<ProviderUser>;

  /**
   * Refresh access token using refresh token
   * Optional: not all providers support refresh tokens
   * 
   * @param refreshToken - Valid refresh token
   * @returns New tokens
   */
  refreshToken?(refreshToken: string): Promise<ProviderTokens>;
}

/**
 * Identity Provider Registry
 */
export class IdentityProviderRegistry {
  private providers = new Map<string, IIdentityProvider>();

  register(provider: IIdentityProvider): void {
    this.providers.set(provider.name, provider);
  }

  get(name: string): IIdentityProvider | undefined {
    return this.providers.get(name);
  }

  getEnabled(): IIdentityProvider[] {
    return Array.from(this.providers.values()).filter(p => p.isEnabled());
  }

  getAll(): IIdentityProvider[] {
    return Array.from(this.providers.values());
  }

  has(name: string): boolean {
    return this.providers.has(name);
  }
}

// Global registry instance
export const identityProviders = new IdentityProviderRegistry();
