import * as fs from 'fs';

import * as path from 'path';

import BaseAuthClient  from './BaseAuthClient';

interface OAuthConfig {

    [key: string]: any;

}

class LocalAuthClient extends BaseAuthClient<Record<string, any>> {

    private oauthConfigBaseDir: string;

    private credentialsBaseDir: string;

    constructor(oauthConfigBaseDir?: string, credentialsBaseDir?: string) {

        super();

        const projectRoot = path.resolve(__dirname, '../../..');

        console.info(`Using project root: ${projectRoot}`);

        this.oauthConfigBaseDir = oauthConfigBaseDir || process.env.GUMCP_OAUTH_CONFIG_DIR || path.join(projectRoot, 'local_auth', 'oauth_configs');

        this.credentialsBaseDir = credentialsBaseDir || process.env.GUMCP_CREDENTIALS_DIR || path.join(projectRoot, 'local_auth', 'credentials');

        // Ensure directories exist

        if (this.oauthConfigBaseDir) {

            fs.mkdirSync(this.oauthConfigBaseDir, { recursive: true });

        }

        if (this.credentialsBaseDir) {

            fs.mkdirSync(this.credentialsBaseDir, { recursive: true });

        }

    }

    public getOAuthConfig(serviceName: string): OAuthConfig {

        if (!this.oauthConfigBaseDir) {

            throw new Error("OAuth config directory not set");

        }

        const serviceDir = path.join(this.oauthConfigBaseDir, serviceName);

        fs.mkdirSync(serviceDir, { recursive: true });

        const configPath = path.join(serviceDir, 'oauth.json');

        if (!fs.existsSync(configPath)) {

            throw new Error(`OAuth config not found for ${serviceName} at ${configPath}`);

        }

        const configData = fs.readFileSync(configPath, 'utf-8');

        return JSON.parse(configData);

    }

    public getUserCredentials(serviceName: string, userId: string) {

        if (!this.credentialsBaseDir) {

            throw new Error("Credentials directory not set");

        }

        const serviceDir = path.join(this.credentialsBaseDir, serviceName);

        fs.mkdirSync(serviceDir, { recursive: true });

        const credsPath = path.join(serviceDir, `${userId}_credentials.json`);

        if (!fs.existsSync(credsPath)) {

            return null;

        }

        const credentialsData = fs.readFileSync(credsPath, 'utf-8');

        return JSON.parse(credentialsData);

    }

    public saveUserCredentials(serviceName: string, userId: string, credentials: Record<string, any> | Record<string, any>): void {

        if (!this.credentialsBaseDir) {

            throw new Error("Credentials directory not set");

        }

        const serviceDir = path.join(this.credentialsBaseDir, serviceName);

        fs.mkdirSync(serviceDir, { recursive: true });

        const credsPath = path.join(serviceDir, `${userId}_credentials.json`);

        let credentialsJson: string;

        if (typeof (credentials as any).toJSON === 'function') {

            // If credentials object has a toJSON method, use it

            credentialsJson = JSON.stringify((credentials as any).toJSON());

        } else if (typeof credentials === 'object') {

            // If credentials is already an object, serialize it

            credentialsJson = JSON.stringify(credentials);

        } else {

            // Try to serialize the object directly

            credentialsJson = JSON.stringify(credentials);

        }

        fs.writeFileSync(credsPath, credentialsJson);

    }

}

export default LocalAuthClient