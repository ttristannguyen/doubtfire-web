// This file can be replaced during build by using the `fileReplacements` array.
// `ng build ---prod` replaces `environment.ts` with `environment.prod.ts`.
// The list of file replacements can be found in `angular.json`.

const defaultKeycloak = {
  url: 'http://localhost:8080',
  realm: 'doubtfire',
  clientId: 'doubtfire-web',
};

type KeycloakWindowConfig = Partial<typeof defaultKeycloak>;

let keycloakWindowConfig: KeycloakWindowConfig = {};

if (typeof window !== 'undefined') {
  const globalWindow = window as unknown as {__keycloakConfig?: KeycloakWindowConfig};
  if (globalWindow.__keycloakConfig) {
    keycloakWindowConfig = globalWindow.__keycloakConfig;
  }
}

export const environment = {
  production: false,
  keycloak: {
    url: keycloakWindowConfig.url || defaultKeycloak.url,
    realm: keycloakWindowConfig.realm || defaultKeycloak.realm,
    clientId: keycloakWindowConfig.clientId || defaultKeycloak.clientId,
  },
};

/*
 * In development mode, to ignore zone related error stack frames such as
 * `zone.run`, `zoneDelegate.invokeTask` for easier debugging, you can
 * import the following file, but please comment it out in production mode
 * because it will have performance impact when throw error
 */
// import 'zone.js/plugins/zone-error';  // Included with Angular CLI.
