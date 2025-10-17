import {Injectable} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {BehaviorSubject, combineLatest, firstValueFrom} from 'rxjs';
import {DoubtfireConstants} from 'src/app/config/constants/doubtfire-constants';
import {StateService, UIRouter, UIRouterGlobals} from '@uirouter/angular';
import {AlertService} from 'src/app/common/services/alert.service';
import {KeycloakAuthService} from 'src/app/auth/keycloak-auth.service';
import {User, UserService} from 'src/app/api/models/doubtfire-model';
import {AppInjector} from 'src/app/app-injector';

export type SessionState = 'pending' | 'authenticated' | 'unauthenticated';

@Injectable()
export class AuthenticationService {
  private readonly AUTH_ME_URL: string;
  private readonly USER_STORAGE_KEY = 'doubtfire_user';
  private readonly REALM_ROLE_STORAGE_KEY = 'doubtfire_roles';

  private hydratePromise?: Promise<void>;
  private realmRoles: string[] = [];

  private readonly sessionStateSubject = new BehaviorSubject<SessionState>('pending');
  public readonly sessionState$ = this.sessionStateSubject.asObservable();

  constructor(
    private httpClient: HttpClient,
    private userService: UserService,
    private alertService: AlertService,
    private state: StateService,
    private doubtfireConstants: DoubtfireConstants,
    private router: UIRouter,
    private uiRouterGlobals: UIRouterGlobals,
    private keycloak: KeycloakAuthService,
  ) {
    this.AUTH_ME_URL = `${this.doubtfireConstants.API_URL}/auth/me`;

    combineLatest([this.keycloak.ready$, this.keycloak.authenticated$]).subscribe(
      ([ready, isAuthenticated]) => {
        if (!ready) {
          return;
        }

        if (isAuthenticated) {
          if (this.sessionStateSubject.value !== 'authenticated') {
            this.ensureUserLoaded()
              .then(() => this.sessionStateSubject.next('authenticated'))
              .catch(() => this.sessionStateSubject.next('unauthenticated'));
          }
        } else if (this.sessionStateSubject.value !== 'unauthenticated') {
          this.clearCurrentUser();
          this.sessionStateSubject.next('unauthenticated');
        }
      },
    );
  }

  public async bootstrap(): Promise<boolean> {
    try {
      const authenticated = await this.keycloak.init();
      if (authenticated) {
        await this.ensureUserLoaded();
        this.sessionStateSubject.next('authenticated');
      } else {
        this.sessionStateSubject.next('unauthenticated');
      }
      return authenticated;
    } catch (_error) {
      this.sessionStateSubject.next('unauthenticated');
      return false;
    }
  }

  public isAuthenticated(): boolean {
    return this.keycloak.isAuthenticated();
  }

  public signIn = async (redirectUri?: string): Promise<void> => {
    const targetRedirect = typeof redirectUri === 'string' ? redirectUri : undefined;
    const keycloakService = this.keycloak ?? AppInjector?.get(KeycloakAuthService);
    if (!keycloakService) {
      throw new Error('Keycloak authentication service is not available');
    }

    this.keycloak = keycloakService;
    // eslint-disable-next-line no-console
    console.info('[AuthenticationService] redirecting to Keycloak login', {
      redirectUri: targetRedirect,
    });
    try {
      await keycloakService.init();
    } catch (initialiseError) {
      // eslint-disable-next-line no-console
      console.error('[AuthenticationService] Keycloak init failed before login', initialiseError);
      throw initialiseError;
    }
    await keycloakService.login(targetRedirect);
  };

  public signOut(ssoSignOut = true): void {
    this.clearCurrentUser();
    this.sessionStateSubject.next('unauthenticated');

    if (ssoSignOut) {
      const redirectUri =
        typeof window !== 'undefined' ? `${window.location.origin}/sign_in` : undefined;
      void this.keycloak.logout(redirectUri);
    }

    this.state.go('sign_in');
  }

  public timeoutAuthentication(): void {
    if (this.uiRouterGlobals.current.name !== 'timeout') {
      this.alertService.error('Authentication timed out', 6000);
      setTimeout(() => this.router.stateService.go('timeout'), 500);
    }
  }

  public async getValidToken(minValiditySeconds = 60): Promise<string | null> {
    return this.keycloak.getValidToken(minValiditySeconds);
  }

  public getScormToken() {
    return this.httpClient.get<{scorm_auth_token: string}>(
      `${this.doubtfireConstants.API_URL}/auth/scorm`,
    );
  }

  public hasRealmRole(role: string): boolean {
    return this.realmRoles.includes(role) || this.keycloak.hasRealmRole(role);
  }

  public isAuthorised(roleWhitelist: string[]): boolean {
    if (!roleWhitelist || roleWhitelist.length === 0) {
      return true;
    }

    const normalizedWhitelist = roleWhitelist.map((role) => role.toLowerCase());
    const roles = new Set<string>();

    const systemRole = this.userService.currentUser?.systemRole;
    if (systemRole) {
      roles.add(systemRole.toLowerCase());
    }

    this.realmRoles.forEach((role) => roles.add(role.toLowerCase()));

    return normalizedWhitelist.some((role) => roles.has(role));
  }

  public getRealmRoles(): string[] {
    return [...this.realmRoles];
  }

  public saveCurrentUser(): void {
    if (this.userService.currentUser.id) {
      localStorage.setItem(this.USER_STORAGE_KEY, JSON.stringify(this.userService.currentUser));
      localStorage.setItem(this.REALM_ROLE_STORAGE_KEY, JSON.stringify(this.realmRoles));
    }
  }

  private async ensureUserLoaded(): Promise<void> {
    if (!this.keycloak.isAuthenticated()) {
      return;
    }

    if (this.hydratePromise) {
      return this.hydratePromise;
    }

    this.hydratePromise = this.hydrateCurrentUser().finally(() => {
      this.hydratePromise = undefined;
    });

    return this.hydratePromise;
  }

  private async hydrateCurrentUser(): Promise<void> {
    try {
      const response = await firstValueFrom(
        this.httpClient.get<{user: User; realm_roles?: string[]}>(this.AUTH_ME_URL),
      );

      const cachedUser = this.userService.cache.getOrCreate(
        response.user.id,
        this.userService,
        response.user,
      );

      Object.assign(cachedUser, response.user);
      cachedUser.authenticationToken = (await this.keycloak.getValidToken(60)) ?? '';

      this.userService.cache.add(cachedUser);
      this.userService.currentUser = cachedUser;
      this.realmRoles = response.realm_roles ?? [];
      this.saveCurrentUser();
    } catch (error: unknown) {
      this.clearCurrentUser();
      throw error;
    }
  }

  private clearCurrentUser(): void {
    this.realmRoles = [];
    this.userService.currentUser = this.userService.anonymousUser;
    localStorage.removeItem(this.USER_STORAGE_KEY);
    localStorage.removeItem(this.REALM_ROLE_STORAGE_KEY);
  }
}
