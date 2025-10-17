import Keycloak, {
  KeycloakInitOptions,
  KeycloakLoginOptions,
  KeycloakTokenParsed,
} from 'keycloak-js';
import {Injectable} from '@angular/core';
import {BehaviorSubject, Observable} from 'rxjs';
import {environment} from 'src/environments/environment';

@Injectable({providedIn: 'root'})
export class KeycloakAuthService {
  private keycloak?: Keycloak;
  private initPromise?: Promise<boolean>;
  private refreshTimeout?: ReturnType<typeof setTimeout>;

  private readonly readySubject = new BehaviorSubject<boolean>(false);
  private readonly authenticatedSubject = new BehaviorSubject<boolean>(false);
  private readonly tokenSubject = new BehaviorSubject<string | null>(null);

  public readonly ready$: Observable<boolean> = this.readySubject.asObservable();
  public readonly authenticated$: Observable<boolean> = this.authenticatedSubject.asObservable();
  public readonly token$: Observable<string | null> = this.tokenSubject.asObservable();

  public init(options?: Partial<KeycloakInitOptions>): Promise<boolean> {
    if (this.initPromise) {
      return this.initPromise;
    }
    this.initPromise = this.initialiseClient(options);
    return this.initPromise;
  }

  public async login(redirectUri?: string): Promise<void> {
    await this.ensureClient();
    if (!this.keycloak) {
      // eslint-disable-next-line no-console
      console.error('[KeycloakAuthService] Keycloak client missing during login invocation');
      throw new Error('Keycloak client not initialised');
    }
    if (typeof this.keycloak.login !== 'function') {
      // eslint-disable-next-line no-console
      console.error('[KeycloakAuthService] Keycloak login API is not a function', {
        type: typeof this.keycloak.login,
      });
      throw new Error('Keycloak login API unavailable');
    }
    const loginOptions: KeycloakLoginOptions | undefined = redirectUri ? {redirectUri} : undefined;
    const loginUrl = this.keycloak.createLoginUrl(loginOptions);
    if (!loginUrl) {
      // eslint-disable-next-line no-console
      console.error('[KeycloakAuthService] Failed to generate Keycloak login URL');
      throw new Error('Unable to generate Keycloak login URL');
    }
    // eslint-disable-next-line no-console
    console.info('[KeycloakAuthService] redirecting to login URL', {loginUrl});
    window.location.assign(loginUrl);
  }

  public async logout(redirectUri?: string): Promise<void> {
    if (!this.keycloak) {
      return;
    }
    this.clearRefreshTimer();
    this.tokenSubject.next(null);
    this.authenticatedSubject.next(false);
    await this.keycloak.logout({redirectUri});
  }

  public isAuthenticated(): boolean {
    return !!this.keycloak?.authenticated;
  }

  public getToken(): string | null {
    return this.keycloak?.token ?? null;
  }

  public getParsedToken(): KeycloakTokenParsed | undefined {
    return this.keycloak?.tokenParsed;
  }

  public async getValidToken(minValiditySeconds = 60): Promise<string | null> {
    await this.updateToken(minValiditySeconds);
    return this.getToken();
  }

  public hasRealmRole(role: string): boolean {
    return this.keycloak?.hasRealmRole(role) ?? false;
  }

  public getRealmRoles(): string[] {
    const parsedToken = this.keycloak?.tokenParsed as Record<string, unknown> | undefined;
    const realmAccess = parsedToken?.realm_access as {roles?: string[]};
    return realmAccess?.roles ?? [];
  }

  private async initialiseClient(options?: Partial<KeycloakInitOptions>): Promise<boolean> {
    await this.ensureClient();

    const initOptions: KeycloakInitOptions = {
      onLoad: 'check-sso',
      pkceMethod: 'S256',
      flow: 'standard',
      checkLoginIframe: false,
      silentCheckSsoRedirectUri: this.silentCheckSsoUri,
      ...options,
    };

    let authenticated = false;
    try {
      authenticated = await this.keycloak!.init(initOptions);
    } catch (initError) {
      const message = initError instanceof Error ? initError.message : String(initError);
      const structuredMessage =
        typeof initError === 'object' && initError !== null && 'error' in initError
          ? String((initError as {error?: unknown}).error)
          : undefined;

      const combinedMessage = structuredMessage ?? message;

      if (combinedMessage?.includes('Timeout when waiting for 3rd party check iframe message')) {
        // eslint-disable-next-line no-console
        console.warn(
          '[KeycloakAuthService] third-party cookie check timed out; continuing without SSO',
          {
            error: initError,
          },
        );
        this.authenticatedSubject.next(false);
        this.tokenSubject.next(null);
        this.readySubject.next(true);
        return false;
      }

      this.authenticatedSubject.next(false);
      this.tokenSubject.next(null);
      this.readySubject.next(true);
      throw initError;
    }

    this.keycloak!.onAuthSuccess = () => this.handleAuthSuccess();
    this.keycloak!.onAuthRefreshSuccess = () => this.handleAuthSuccess();
    this.keycloak!.onTokenExpired = () => {
      void this.updateToken(60);
    };

    if (authenticated) {
      this.handleAuthSuccess();
    } else {
      this.authenticatedSubject.next(false);
      this.tokenSubject.next(null);
    }

    this.readySubject.next(true);
    return authenticated;
  }

  private async ensureClient(): Promise<void> {
    if (this.keycloak) {
      return;
    }

    this.keycloak = new Keycloak({
      url: environment.keycloak.url.replace(/\/$/, ''),
      realm: environment.keycloak.realm,
      clientId: environment.keycloak.clientId,
    });
    // eslint-disable-next-line no-console
    console.info('[KeycloakAuthService] constructed new Keycloak instance', {
      url: environment.keycloak.url,
      realm: environment.keycloak.realm,
      clientId: environment.keycloak.clientId,
    });
  }

  private handleAuthSuccess(): void {
    this.authenticatedSubject.next(true);
    this.tokenSubject.next(this.keycloak?.token ?? null);
    this.scheduleRefresh();
  }

  private async updateToken(minValiditySeconds = 60): Promise<boolean> {
    if (!this.keycloak) {
      return false;
    }

    try {
      const refreshed = await this.keycloak.updateToken(minValiditySeconds);
      this.tokenSubject.next(this.keycloak.token ?? null);
      this.scheduleRefresh();
      return refreshed;
    } catch (error) {
      this.clearRefreshTimer();
      this.authenticatedSubject.next(false);
      this.tokenSubject.next(null);
      throw error;
    }
  }

  private scheduleRefresh(): void {
    if (!this.keycloak?.tokenParsed?.exp) {
      return;
    }

    this.clearRefreshTimer();
    const expirationTimeMs = this.keycloak.tokenParsed.exp * 1000;
    const now = Date.now();
    const refreshInMs = Math.max(expirationTimeMs - now - 60_000, 10_000);

    this.refreshTimeout = setTimeout(() => {
      void this.updateToken(60).catch(() => {
        this.authenticatedSubject.next(false);
        this.tokenSubject.next(null);
      });
    }, refreshInMs);
  }

  private clearRefreshTimer(): void {
    if (this.refreshTimeout) {
      clearTimeout(this.refreshTimeout);
      this.refreshTimeout = undefined;
    }
  }

  private get silentCheckSsoUri(): string | undefined {
    if (typeof window === 'undefined') {
      return undefined;
    }
    return `${window.location.origin}/assets/silent-check-sso.html`;
  }
}
