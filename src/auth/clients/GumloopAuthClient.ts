
import * as logging from 'loglevel';

import axios from 'axios';

import BaseAuthClient from './BaseAuthClient';

const logger = logging.getLogger("gumloop-auth-client");

class GumloopAuthClient extends BaseAuthClient<Record<string, any>> {

    private apiBaseUrl: string;

    private apiKey: string | undefined;

    /**
    
    * Initialize the Gumloop auth client
    
    *
    
    * @param apiKey Gumloop API key for service authentication
    
    */

    constructor(apiKey?: string) {

        super();

        this.apiBaseUrl = process.env.GUMLOOP_API_BASE_URL || "https://api.gumloop.com/api/v1";

        this.apiKey = apiKey;

        if (!this.apiBaseUrl || !this.apiKey) {

            logger.warn("Missing configuration for GumloopAuthClient. Some functionality may be limited.");

        }

    }

    /**
    
    * Get user credentials from Gumloop API
    
    *
    
    * @param serviceName Name of the service
    
    * @param userId Identifier for the user
    
    * @returns Credentials object if found, undefined otherwise
    
    */

    public async getUserCredentials(serviceName: string, userId: string) {

        const url = `${this.apiBaseUrl}/auth/${serviceName}/credentials?user_id=${userId}`;

        const headers = { Authorization: `Bearer ${this.apiKey}` };

        try {

            const response = await axios.get(url, { headers });

            if (response.status !== 200) {

                logger.error(`Failed to get credentials for ${serviceName} user ${userId}: ${response.data}`);

                return undefined;

            }

            // Return the credentials data as a dictionary

            // The caller is responsible for converting to the appropriate credentials type

            return response.data;

        } catch (error) {

            logger.error(`Error retrieving credentials for ${serviceName} user ${userId}: ${error}`);

            return undefined;

        }

    }

}

export default GumloopAuthClient;