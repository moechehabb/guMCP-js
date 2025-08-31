

abstract class BaseAuthClient<CredentialsT> {
    /**
     * Retrieves user credentials for a specific service. Credentials returned
     * here should be ready-to-use (ex. access tokens should be refreshed
     * already)
     *
     * @param serviceName Name of the service (e.g., "gdrive", "github", etc.)
     * @param userId Identifier for the user
     * @returns Credentials object if found, None otherwise
     */
    abstract getUserCredentials(
      serviceName: string,
      userId: string
    ): CredentialsT | undefined;
  
    /**
     * Retrieves OAuth configuration for a specific service
     *
     * @param serviceName Name of the service (e.g., "gdrive", "github", etc.)
     * @returns Dict containing OAuth configuration
     */
    getOAuthConfig(serviceName: string): { [key: string]: any } {
      throw new Error(
        "This method is optional and not implemented by this client"
      );
    }
  
    /**
     * Saves user credentials after authentication or refresh
     *
     * @param serviceName Name of the service (e.g., "gdrive", "github", etc.)
     * @param userId Identifier for the user
     * @param credentials Credentials object to save
     */
    saveUserCredentials(
      serviceName: string,
      userId: string,
      credentials: CredentialsT
    ): void {
      throw new Error(
        "This method is optional and not implemented by this client"
      );
    }
  }
  
  export default BaseAuthClient;
  