import * as process from 'process';
import * as http from 'http';
import * as url from 'url';
import open from 'open'; // For opening the browser
import { OAuth2Client, Credentials } from 'google-auth-library'; // Core Google Auth library
import { GaxiosError } from 'gaxios'; // For specific error handling

// --- Placeholder for your Auth Client ---
// You MUST replace this with your actual implementation.
interface OAuthConfig {
    // Structure expected by google-auth-library's OAuth2Client constructor
    // Usually derived from the client_secrets.json file
    client_id: string;
    client_secret: string;
    redirect_uris: string[];
    // Add other fields if necessary (e.g., project_id, auth_uri, token_uri)
}

// Define the structure of credentials as stored/retrieved by your AuthClient
// This should match what google-auth-library's setCredentials expects
interface StoredCredentials extends Credentials {
    // Ensure refresh_token is included if offline access is needed
    refresh_token?: string | null;
}

interface AuthClient {
    // Gets the OAuth configuration (client ID, secret, etc.) for a service
    getOAuthConfig(serviceName: string): Promise<OAuthConfig | null>; // Make async if needed

    // Retrieves stored credentials for a user and service
    getUserCredentials(serviceName: string, userId: string): Promise<StoredCredentials | null>;

    // Saves credentials for a user and service
    saveUserCredentials(serviceName: string, userId: string, credentials: StoredCredentials): Promise<void>;
}

// Placeholder function - replace with your actual factory import/implementation
function createAuthClient(apiKey?: string | null): AuthClient {
    console.log(`AuthClient requested${apiKey ? ' with API key' : ''}. Using placeholder.`);
    // --- Replace with your actual AuthClient implementation ---
    return {
        async getOAuthConfig(serviceName: string): Promise<OAuthConfig | null> {
            console.warn(`[Placeholder] getOAuthConfig called for ${serviceName}. Returning dummy data.`);
            // Example: Load from a config file or environment variables
            // Ensure this path/logic is correct for your setup
            try {
                // Simulating loading config, e.g., from ENV or a file
                const clientId = process.env[`${serviceName.toUpperCase()}_CLIENT_ID`];
                const clientSecret = process.env[`${serviceName.toUpperCase()}_CLIENT_SECRET`];

                if (!clientId || !clientSecret) {
                    console.error(`Missing CLIENT_ID or CLIENT_SECRET for ${serviceName} in environment`);
                    return null;
                }
                return {
                    client_id: clientId,
                    client_secret: clientSecret,
                    redirect_uris: ['http://localhost:8080'] // Must match the redirect URI used below
                };
            } catch (error) {
                console.error(`Error loading OAuth config for ${serviceName}:`, error);
                return null;
            }
        },
        async getUserCredentials(serviceName: string, userId: string): Promise<StoredCredentials | null> {
            console.warn(`[Placeholder] getUserCredentials called for ${serviceName}/${userId}. Returning null.`);
            // Example: Read from a database or secure storage
            // const data = await db.getCredentials(serviceName, userId);
            // return data ? JSON.parse(data) : null;
            return null; // Simulate not found initially
        },
        async saveUserCredentials(serviceName: string, userId: string, credentials: StoredCredentials): Promise<void> {
            console.warn(`[Placeholder] saveUserCredentials called for ${serviceName}/${userId}. Data:`, credentials);
            // Example: Save to database or secure storage
            // await db.saveCredentials(serviceName, userId, JSON.stringify(credentials));
        },
    };
    // --- End of placeholder ---
}
// --- End Placeholder ---


// Simple logger (replace with Winston, Pino, etc. if needed)
const getLogger = (serviceName: string) => ({
    info: (...args: any[]) => console.log(`[${new Date().toISOString()}] INFO [${serviceName}] -`, ...args),
    error: (...args: any[]) => console.error(`[${new Date().toISOString()}] ERROR [${serviceName}] -`, ...args),
    warn: (...args: any[]) => console.warn(`[${new Date().toISOString()}] WARN [${serviceName}] -`, ...args),
});

/**
 * Authenticates with Google via interactive OAuth2 flow and saves credentials.
 */
export async function authenticateAndSaveCredentials(
    userId: string,
    serviceName: string,
    scopes: string[]
): Promise<Credentials> {
    const logger = getLogger(serviceName);
    logger.info(`Launching auth flow for user ${userId}...`);

    const authClient = createAuthClient();

    // 1. Get OAuth Config
    const oauthConfig = await authClient.getOAuthConfig(serviceName);
    if (!oauthConfig) {
        throw new Error(`Failed to retrieve OAuth configuration for service: ${serviceName}`);
    }
    if (!oauthConfig.redirect_uris || oauthConfig.redirect_uris.length === 0) {
         throw new Error(`OAuth configuration for ${serviceName} must include redirect_uris.`);
    }
    // Use the first redirect URI for the local server flow
    const redirectUri = oauthConfig.redirect_uris[0];
    const port = parseInt(url.parse(redirectUri).port || '8080', 10); // Extract port

    // 2. Create OAuth2Client
    const oauth2Client = new OAuth2Client(
        oauthConfig.client_id,
        oauthConfig.client_secret,
        redirectUri
    );

    // 3. Generate Auth URL
    const authorizeUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline', // Request refresh token
        scope: scopes,
        prompt: 'consent', // Force consent screen to ensure refresh token is granted
    });

    logger.info('Please open the following URL in your browser:');
    logger.info(authorizeUrl);

    // 4. Start local server to listen for callback and get code
    return new Promise<Credentials>((resolve, reject) => {
        const server = http.createServer(async (req, res) => {
            try {
                if (!req.url) {
                    throw new Error('Request URL is missing');
                }
                const qs = new url.URL(req.url, redirectUri).searchParams;
                const code = qs.get('code');
                const error = qs.get('error');

                if (error) {
                    throw new Error(`Authentication failed: ${error}`);
                }
                if (!code) {
                    throw new Error('Authentication failed: No code received.');
                }

                logger.info('Authorization code received. Exchanging for tokens...');
                res.end('Authentication successful! You can close this window.'); // Send response to browser
                server.close(); // Stop the server

                // 5. Exchange code for tokens
                const { tokens } = await oauth2Client.getToken(code);
                logger.info('Tokens obtained.');

                // Ensure the client has the new tokens set
                oauth2Client.setCredentials(tokens);

                // 6. Save Credentials (Ensure refresh_token is included in 'tokens')
                if (!tokens.refresh_token) {
                     logger.warn('No refresh token received. Future requests might fail after access token expiry.');
                     // You might want to reject here depending on requirements:
                     // reject(new Error('Authentication failed: No refresh token received. Ensure project is configured correctly and prompt=consent was used.'));
                     // return;
                }
                // Cast to StoredCredentials to satisfy the interface (assuming Credentials and StoredCredentials are compatible)
                await authClient.saveUserCredentials(serviceName, userId, tokens as StoredCredentials);

                logger.info(`Credentials saved for user ${userId}.`);
                resolve(tokens); // Resolve the promise with the obtained tokens

            } catch (e: any) {
                logger.error('Authentication error:', e);
                // Try to send an error response to the browser if possible
                try {
                    res.writeHead(400, { 'Content-Type': 'text/plain' });
                    res.end(`Authentication failed: ${e.message}`);
                } catch (respErr) {
                    logger.error('Failed to send error response to browser:', respErr);
                }
                server.close();
                reject(e); // Reject the promise
            }
        });

        server.listen(port, () => {
            logger.info(`Local server listening on ${redirectUri}`);
            // 7. Open browser automatically
            open(authorizeUrl).catch(err => {
                logger.error('Failed to automatically open browser:', err);
                logger.info('Please manually open the URL provided above.');
            });
        });

        server.on('error', (err) => {
            reject(new Error(`Failed to start local server on port ${port}: ${err.message}`));
        });
    });
}


/**
 * Retrieves credentials for the specified user and returns an authenticated OAuth2Client.
 */
export async function getCredentials(
    userId: string,
    serviceName: string,
    apiKey?: string | null
): Promise<OAuth2Client> { // Returns the client, ready to use
    const logger = getLogger(serviceName);
    const authClient = createAuthClient(apiKey); // Pass API key if needed by your factory

    // 1. Get Stored Credentials
    const credentialsData = await authClient.getUserCredentials(serviceName, userId);

    const handleMissingCredentials = () => {
        let errorStr = `Credentials not found for user '${userId}' and service '${serviceName}'.`;
        // Using 'NODE_ENV' is more standard in Node.js than 'ENVIRONMENT'
        if (process.env.NODE_ENV !== 'production') { // Check if not in production
            errorStr += ` Please run the authentication flow first (e.g., node your_script.js auth ${userId}).`;
        }
        logger.error(errorStr);
        throw new Error(`Credentials not found for user ${userId}`);
    };

    if (!credentialsData) {
        handleMissingCredentials();
        // Throwing error above, so this won't be reached, but satisfies TS compiler
        throw new Error('Credentials not found');
    }

    // Need client_id and client_secret to initialize OAuth2Client even when using stored tokens
     const oauthConfig = await authClient.getOAuthConfig(serviceName);
     if (!oauthConfig) {
        throw new Error(`Failed to retrieve OAuth configuration for service: ${serviceName} while loading credentials.`);
     }

    // 2. Create OAuth2Client and Set Credentials
    const oauth2Client = new OAuth2Client(
        oauthConfig.client_id,
        oauthConfig.client_secret
        // Redirect URI isn't strictly needed here if we're just refreshing/using tokens,
        // but providing it is safer if any auth flows are triggered implicitly.
        // Use the first one from config if available.
        // oauthConfig.redirect_uris ? oauthConfig.redirect_uris[0] : undefined
    );

    oauth2Client.setCredentials(credentialsData);

    // 3. Handle Token Refresh (Optional but recommended check)
    // google-auth-library handles refresh automatically when making API calls *if* a refresh token exists
    // and the client ID/secret are correct. We can optionally check expiry here.
    if (credentialsData.expiry_date && credentialsData.expiry_date <= Date.now()) {
        logger.info(`Access token expired for ${userId}. Attempting refresh...`);
        try {
            // The refresh will happen implicitly on the next API call,
            // but we can force it here if needed.
            const refreshedTokens = await oauth2Client.refreshAccessToken();
            logger.info(`Token refreshed successfully for ${userId}.`);
            // Optionally re-save the potentially updated tokens (especially if expiry changed)
            // Note: refreshAccessToken() response might not include a *new* refresh token
             await authClient.saveUserCredentials(serviceName, userId, {
                 ...credentialsData, // Keep original refresh token
                 ...refreshedTokens.credentials // Add new access token, expiry etc.
             });
        } catch (err) {
             const gaxiosError = err as GaxiosError;
             logger.error(`Failed to refresh token for user ${userId}: ${gaxiosError.message}`);
             if (gaxiosError.response?.data?.error === 'invalid_grant') {
                 logger.error('Refresh token may be invalid or revoked. User might need to re-authenticate.');
                 // Re-throw a specific error or handle re-authentication trigger
             }
             // Depending on requirements, you might want to throw here or let the subsequent API call fail
             // throw new Error(`Failed to refresh token: ${gaxiosError.message}`);
        }
    }

    // The Python code had a check for `access_token` without `token`.
    // `google-auth-library` standard is `access_token`. We assume `credentialsData`
    // follows the `Credentials` interface structure. If `access_token` is missing,
    // `setCredentials` or subsequent API calls will likely fail.
    if (!oauth2Client.credentials.access_token) {
        logger.error(`Loaded credentials for ${userId} are missing 'access_token'.`);
        handleMissingCredentials(); // Or throw a more specific error
        throw new Error('Loaded credentials invalid'); // Satisfy TS
    }

    logger.info(`Credentials loaded successfully for user ${userId}. OAuth2Client ready.`);
    return oauth2Client;
}