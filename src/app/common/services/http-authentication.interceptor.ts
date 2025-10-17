import {Injectable} from '@angular/core';
import {HttpRequest, HttpHandler, HttpEvent, HttpInterceptor} from '@angular/common/http';
import {Observable, from} from 'rxjs';
import {switchMap} from 'rxjs/operators';
import API_URL from 'src/app/config/constants/apiURL';
import {KeycloakAuthService} from 'src/app/auth/keycloak-auth.service';
import {UserService} from 'src/app/api/services/user.service';

@Injectable()
export class HttpAuthenticationInterceptor implements HttpInterceptor {
  constructor(
    private keycloak: KeycloakAuthService,
    private userService: UserService,
  ) {}

  intercept(request: HttpRequest<unknown>, next: HttpHandler): Observable<HttpEvent<unknown>> {
    if (!request.url.startsWith(API_URL)) {
      return next.handle(request);
    }

    return from(this.keycloak.getValidToken()).pipe(
      switchMap((token) => {
        if (token && this.userService.currentUser) {
          this.userService.currentUser.authenticationToken = token;
        }

        const authorisedRequest = token
          ? request.clone({
              setHeaders: {
                Authorization: `Bearer ${token}`,
              },
            })
          : request;

        return next.handle(authorisedRequest);
      }),
    );
  }
}
