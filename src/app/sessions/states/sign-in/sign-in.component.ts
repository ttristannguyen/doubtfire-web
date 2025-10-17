import {HttpClient} from '@angular/common/http';
import {Component, OnInit} from '@angular/core';
import {StateService, Transition} from '@uirouter/core';
import {BehaviorSubject} from 'rxjs';
import {AuthenticationService} from 'src/app/api/services/authentication.service';
import {AlertService} from 'src/app/common/services/alert.service';
import {DoubtfireConstants} from 'src/app/config/constants/doubtfire-constants';
import {GlobalStateService} from 'src/app/projects/states/index/global-state.service';

interface AuthMethodResponse {
  redirect_to?: string | null;
}

type signInData =
  | {
      username: string;
      password: string;
      remember: boolean;
      autoLogin: boolean;
      auth_token?: string;
    }
  | {
      auth_token: string;
      username: string;
      remember: boolean;
      password?: string;
      autoLogin?: boolean;
    };
@Component({
  selector: 'f-sign-in',
  templateUrl: './sign-in.component.html',
  styleUrls: ['./sign-in.component.scss'],
})
export class SignInComponent implements OnInit {
  signingIn = false;
  showCredentials = false;
  invalidCredentials = false;
  api: string;
  SSOLoginUrl: string | null = null;
  authMethodLoaded = false;
  externalName: BehaviorSubject<string>;
  authMethodFailed = false;
  error?: unknown;
  formData: signInData;
  constructor(
    private authService: AuthenticationService,
    private state: StateService,
    private constants: DoubtfireConstants,
    private http: HttpClient,
    private transition: Transition,
    private globalState: GlobalStateService,
    private alerts: AlertService,
  ) {}

  ngOnInit(): void {
    this.formData = {
      username: '',
      password: '',
      remember: false,
      autoLogin: localStorage.getItem('autoLogin') ? true : false,
    };
    // Check for SSO
    this.globalState.hideHeader();
    this.api = this.constants.API_URL;
    this.externalName = this.constants.ExternalName;

    // wait 2 seconds with rxjs
    const wait = new Promise<void>((resolve) => setTimeout(resolve, 2000));
    this.http.get<AuthMethodResponse>(`${this.constants.API_URL}/auth/method`).subscribe({
      next: (response) => {
        this.SSOLoginUrl = response.redirect_to ?? null;

        if (this.SSOLoginUrl) {

          if (this.transition.params().authToken) {
            void this.signIn({
              auth_token: this.transition.params().authToken,
              username: this.transition.params().username,
              remember: true,
            });
            return;
          }

          if (this.formData.autoLogin) {
            void wait.then(() => {
              if (this.formData.autoLogin) {
                this.redirectToSSO();
              }
            });
            return;
          }

          this.showCredentials = false;
          void wait.then(() => {
            this.globalState.isLoadingSubject.next(false);
          });
          return;
        }

        this.authMethodLoaded = true;
        this.showCredentials = true;
        void wait.then(() => {
          this.globalState.isLoadingSubject.next(false);
        });
      },
      error: (err) => {
        this.authMethodFailed = true;
        this.error = err;
        void wait.then(() => {
          this.globalState.isLoadingSubject.next(false);
        });
      },
    });

    if (this.authService.isAuthenticated()) {
      this.state.go('home');
    }
  }

  /**
   * Redirects the window to the SSO login URL, if the SSO login URL is set.
   */
  private redirectToSSO(): void {
    if (this.SSOLoginUrl) {
      if (this.formData.autoLogin) {
        localStorage.setItem('autoLogin', 'true');
      } else {
        localStorage.removeItem('autoLogin');
      }

      window.location.assign(this.SSOLoginUrl);
    }
  }

  async signIn(signInCredentials: signInData): Promise<void> {
    if (this.SSOLoginUrl && !signInCredentials.auth_token) {
      this.redirectToSSO();
      return;
    }

    signInCredentials.remember = true;
    this.signingIn = true;

    try {
      await this.authService.signIn();
      this.state.go('home');
    } catch (err) {
      this.signingIn = false;
      this.formData.password = '';
      this.invalidCredentials = true;
      this.alerts.error(err, 6000);
    }
  }

  private async bootstrapFromKeycloak(): Promise<void> {
    try {
      const authenticated = await this.authService.bootstrap();
      if (authenticated) {
        const destination = this.transition.params().dest || 'home';
        const params = this.transition.params().params
          ? JSON.parse(this.transition.params().params)
          : undefined;
        this.state.go(destination, params);
      }
    } catch (err) {
      this.alerts.error(err, 6000);
    }
  }
}
