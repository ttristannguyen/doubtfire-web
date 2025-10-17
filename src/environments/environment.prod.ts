const defaultKeycloak = {
  url: 'https://auth.example.com',
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
  production: true,
  keycloak: {
    url: keycloakWindowConfig.url || defaultKeycloak.url,
    realm: keycloakWindowConfig.realm || defaultKeycloak.realm,
    clientId: keycloakWindowConfig.clientId || defaultKeycloak.clientId,
  },
};
