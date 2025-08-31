import * as path from 'path';
import * as process from 'process';
import { google, calendar_v3 } from 'googleapis'; // Google API Client
import { OAuth2Client } from 'google-auth-library'; // Google Auth Library
import { format as formatDate } from 'date-fns'; // For date formatting

// --- Placeholder Imports (Replace with actual library imports) ---

// Assuming equivalent functions exist in your utils
import {
    authenticateAndSaveCredentials,
    getCredentials,
} from '../../utils/google/util';
import { fileURLToPath } from 'url';
import { Readable, Writable } from 'stream';

// Assuming MCP framework types/classes exist
// Define placeholder interfaces if the actual library isn't available
interface AnyUrl extends String {} // Simple placeholder

interface Resource {
    uri: AnyUrl;
    mimeType: string;
    name: string;
    description?: string;
}

interface TextContent {
    type: 'text';
    text: string;
}

interface ImageContent { // Placeholder
    type: 'image';
    url: string;
    altText?: string;
}

interface EmbeddedResource { // Placeholder
    type: 'resource';
    resource: Resource;
}

type ReadResourceContents = { // Assuming this structure from Python example
    content: string;
    mimeType: string;
};

interface Tool {
    name: string;
    description: string;
    inputSchema: object; // Define more strictly if possible
}

interface NotificationOptions {} // Placeholder
interface ExperimentalCapabilities {} // Placeholder

interface Capabilities { // Placeholder structure
    // Define based on actual MCP capabilities
}

interface InitializationOptions {
    server_name: string;
    server_version: string;
    capabilities: Capabilities;
}

// --- JSON-RPC Types (Example) ---
interface CalendarRequestParams {
    name?: string;
    calendarId?: string;
    eventId?: string;
    summary?: string;
    description?: string;
    location?: string;
    start_datetime?: string;
    end_datetime?: string;
    attendees?: string[];
    cursor?: string;
    params?: any;
    uri?: AnyUrl;
    args?: any;
}

interface JsonRpcRequest {
    jsonrpc: '2.0';
    method: string;
    params?: CalendarRequestParams | any[];
    id: string | number | null;
}

interface JsonRpcResponse {
    jsonrpc: '2.0';
    result?: any;
    error?: {
        code: number;
        message: string;
        data?: any;
    };
    id: string | number | null;
}


// Placeholder Server class definition
class Server {
    userId: string | null = null;
    apiKey: string | null = null;
    private listResourcesHandler?: (cursor?: string | null) => Promise<Resource[]>;
    private readResourceHandler?: (uri: AnyUrl) => Promise<ReadResourceContents[]>; // Adjusted return type based on python code
    private listToolsHandler?: () => Promise<Tool[]>;
    private callToolHandler?: (name: string, args: Record<string, any> | null) => Promise<Array<TextContent | ImageContent | EmbeddedResource>>;

    constructor(public name: string) {}

    // Methods to register handlers (mimicking Python decorators)
    list_resources() {
        return (handler: (cursor?: string | null) => Promise<Resource[]>) => {
            this.listResourcesHandler = handler.bind(this); // Bind 'this' context
        };
    }

    read_resource() {
        return (handler: (uri: AnyUrl) => Promise<ReadResourceContents[]>) => {
            this.readResourceHandler = handler.bind(this);
        };
    }

    list_tools() {
        return (handler: () => Promise<Tool[]>) => {
            this.listToolsHandler = handler.bind(this);
        };
    }

    call_tool() {
        return (handler: (name: string, args: Record<string, any> | null) => Promise<Array<TextContent | ImageContent | EmbeddedResource>>) => {
            this.callToolHandler = handler.bind(this);
        };
    }

    // Method to get capabilities (replace with actual implementation)
    get_capabilities(options: {
        notification_options: NotificationOptions,
        experimental_capabilities: ExperimentalCapabilities
    }): Capabilities {
        console.log('get_capabilities called with:', options);
        // Actual implementation would gather capabilities based on registered handlers
        return {}; // Return placeholder
    }

    private async handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse | null> {
        const { method, params, id } = request;
        let result: any;
        let error: JsonRpcResponse['error'] | null = null;

        try {
           switch (method) {
               case 'list_resources':
                   if (!this.listResourcesHandler) throw new Error(`Method not found: ${method}`);
                   const cursor = (Array.isArray(params) ? params[0] : params?.cursor) as string | null | undefined;
                   result = await this.listResourcesHandler(cursor ?? null);
                   break;
               case 'read_resource':
                    if (!this.readResourceHandler) throw new Error(`Method not found: ${method}`);
                   const uri = (Array.isArray(params) ? params[0] : params?.uri) as AnyUrl | undefined;
                    if (!uri) throw new Error('Missing parameter: uri');
                   result = await this.readResourceHandler(uri);
                   break;
               case 'list_tools':
                    if (!this.listToolsHandler) throw new Error(`Method not found: ${method}`);
                    result = await this.listToolsHandler();
                   break;
               case 'call_tool':
                   if (!this.callToolHandler) throw new Error(`Method not found: ${method}`);
                   const toolName = (Array.isArray(params) ? params[0] : params?.name) as string | undefined;
                   const toolArgs = (Array.isArray(params) ? params[1] : params?.args) as Record<string, any> | null | undefined;
                    if (!toolName) throw new Error('Missing parameter: name');
                   result = await this.callToolHandler(toolName, toolArgs ?? null);
                   break;
               // Add other methods if your server supports them
               default:
                   throw new Error(`Method not found: ${method}`);
           }
        } catch (e: any) {
            console.error(`Error handling method '${method}': ${e.message}`);
            error = { code: -32603, message: e.message || 'Internal server error' }; // Internal error
        }

        // Don't send response for notifications (requests without id)
        if (id === null || id === undefined) {
            return null;
        }

        if (error) {
            return { jsonrpc: '2.0', error: error, id: id };
        } else {
            return { jsonrpc: '2.0', result: result, id: id };
        }
   }

    async run(readStream: Readable, writeStream: Writable, initOptions: any): Promise<void> {
        console.log(`Server ${this.name} run method started for user ${this.userId}.`);
        console.log(`Initialization options received: ${JSON.stringify(initOptions)}`);

        let buffer = '';

        readStream.on('data', async (chunk) => {
            buffer += chunk.toString();

            // Basic line-based JSON processing (adapt if your protocol is different)
            // A more robust implementation would handle partial JSON objects across chunks.
            let boundary = buffer.indexOf('\n');
            while (boundary !== -1) {
                const line = buffer.substring(0, boundary).trim();
                buffer = buffer.substring(boundary + 1);

                if (line) {
                    try {
                        const request = JSON.parse(line) as JsonRpcRequest; // Assume JSON-RPC
                        console.log(`Received request: ${JSON.stringify(request)}`);

                        // Validate basic JSON-RPC structure
                        if (request.jsonrpc !== '2.0' || !request.method) {
                           throw new Error('Invalid JSON-RPC request');
                        }

                        // Handle the request
                        const response = await this.handleRequest(request);

                        // Send response if it's not a notification
                        if (response) {
                            console.log(`Sending response: ${JSON.stringify(response)}`);
                            writeStream.write(JSON.stringify(response) + '\n');
                        }
                    } catch (error: any) {
                        console.error(`Error processing message: ${error.message}\nLine: ${line}`);
                        // Send JSON-RPC error response if possible
                        const errorResponse: JsonRpcResponse = {
                           jsonrpc: '2.0',
                           error: { code: -32700, message: 'Parse error' }, // Or -32600 for Invalid Request
                           id: null // Cannot determine ID if parse failed early
                        };
                        // Try to extract ID if parsing succeeded but request was invalid
                        try {
                           const parsed = JSON.parse(line);
                           if (parsed && parsed.id !== undefined) errorResponse.id = parsed.id;
                        } catch {} // Ignore secondary parse error
                        writeStream.write(JSON.stringify(errorResponse) + '\n');
                    }
                }
                boundary = buffer.indexOf('\n');
            }
        });

        readStream.on('end', () => {
            console.log('Read stream ended.');
            // Perform cleanup if necessary
        });

        readStream.on('error', (err) => {
            console.error('Read stream error:', err);
        });

        writeStream.on('error', (err) => {
             console.error('Write stream error:', err);
        });

        // Keep the run method alive until the streams close or an error occurs
        // This Promise resolves when the read stream ends, or rejects on error.
        await new Promise<void>((resolve, reject) => {
            readStream.on('end', resolve);
            readStream.on('error', reject);
            writeStream.on('error', reject); // Also reject on write errors
        });

        console.log(`Server ${this.name} run method finished for user ${this.userId}.`);
    }


    // Methods to simulate running the handlers (for testing/actual use)
    async triggerListResources(cursor?: string | null): Promise<Resource[]> {
        if (!this.listResourcesHandler) throw new Error("list_resources handler not registered");
        return this.listResourcesHandler(cursor);
    }
    async triggerReadResource(uri: AnyUrl): Promise<ReadResourceContents[]> {
         if (!this.readResourceHandler) throw new Error("read_resource handler not registered");
        return this.readResourceHandler(uri);
    }
    async triggerListTools(): Promise<Tool[]> {
        if (!this.listToolsHandler) throw new Error("list_tools handler not registered");
        return this.listToolsHandler();
    }
    async triggerCallTool(name: string, args: Record<string, any> | null): Promise<Array<TextContent | ImageContent | EmbeddedResource>> {
        if (!this.callToolHandler) throw new Error("call_tool handler not registered");
        return this.callToolHandler(name, args);
    }
}
// --- End Placeholder // Get the full path to the current file
const currentFilePath = fileURLToPath(import.meta.url);

// Get the full path to the directory containing the current file
const currentDirPath = path.dirname(currentFilePath);

// Get the base name (the actual directory name)
const SERVICE_NAME = path.basename(currentDirPath);

const SCOPES = ['https://www.googleapis.com/auth/calendar'];

// Configure logging (using console)
const logger = {
    info: (...args: any[]) => console.log(`[${new Date().toISOString()}] INFO [${SERVICE_NAME}] -`, ...args),
    error: (...args: any[]) => console.error(`[${new Date().toISOString()}] ERROR [${SERVICE_NAME}] -`, ...args),
    warn: (...args: any[]) => console.warn(`[${new Date().toISOString()}] WARN [${SERVICE_NAME}] -`, ...args),
};


async function createCalendarService(
    userId: string,
    apiKey?: string | null
): Promise<calendar_v3.Calendar> {
    // Assume getCredentials returns an OAuth2Client or similar auth object
    const credentials = await getCredentials(userId, SERVICE_NAME, apiKey);
    if (!credentials) {
        throw new Error(`Could not get credentials for user ${userId}`);
    }
    // Use the credentials directly with googleapis
    const auth = credentials as OAuth2Client; // Cast to the expected type from google-auth-library
    return google.calendar({ version: 'v3', auth });
}

interface FormattedEvent {
    summary: string;
    start: string;
    end: string;
    location: string;
    id: string;
    description: string;
    attendees: string[];
    htmlLink?: string | null; // Added for create/update responses
}

function formatEvent(event: calendar_v3.Schema$Event): FormattedEvent {
    const startInfo = event.start;
    const endInfo = event.end;

    let startFormatted = 'N/A';
    let endFormatted = 'N/A';

    // Format start time/date
    if (startInfo?.dateTime) { // Full datetime
        try {
            startFormatted = formatDate(new Date(startInfo.dateTime), 'yyyy-MM-dd HH:mm');
        } catch (e) { console.error("Error parsing start dateTime:", startInfo.dateTime, e); }
    } else if (startInfo?.date) { // All-day event
        startFormatted = startInfo.date;
    }

    // Format end time/date
    if (endInfo?.dateTime) { // Full datetime
        try {
            endFormatted = formatDate(new Date(endInfo.dateTime), 'yyyy-MM-dd HH:mm');
        } catch (e) { console.error("Error parsing end dateTime:", endInfo.dateTime, e); }
    } else if (endInfo?.date) { // All-day event
        endFormatted = endInfo.date;
    }

    return {
        summary: event.summary || 'No Title',
        start: startFormatted,
        end: endFormatted,
        location: event.location || 'N/A',
        id: event.id || '',
        description: event.description || '',
        attendees: (event.attendees || []).map(a => a.email || 'Unknown Email').filter(email => !!email),
        htmlLink: event.htmlLink // Keep the link if available
    };
}

function createServer(userId?: string | null, apiKey?: string | null): Server {
    const server = new Server('gcalendar-server');

    // Store user context if provided during creation
    server.userId = userId ?? null;
    server.apiKey = apiKey ?? null;

    // --- Resource Handlers ---

    server.list_resources()(async (
        cursor?: string | null
    ): Promise<Resource[]> => {
        if (!server.userId) {
            throw new Error("User ID is not set for list_resources");
        }
        console.log(`Listing calendars for user: ${server.userId} with cursor: ${cursor}`); // Cursor not used in this impl

        const calendarService = await createCalendarService(server.userId, server.apiKey);

        const response = await calendarService.calendarList.list();
        const calendarItems = response.data.items || [];

        const resources: Resource[] = calendarItems.map(calendar => ({
            uri: `gcalendar:///${calendar.id}`,
            mimeType: 'application/vnd.google-apps.calendar+json', // More specific mime type
            name: calendar.summary || 'Unnamed Calendar',
            description: calendar.description || '',
        }));

        // Also add a resource for upcoming events
        resources.push({
            uri: `gcalendar:///upcoming`,
            mimeType: 'text/plain', // This resource provides a text summary
            name: 'Upcoming Events',
            description: 'Events in the next 7 days from the primary calendar',
        });

        return resources;
    });

    server.read_resource()(async (
        uri: AnyUrl
    ): Promise<ReadResourceContents[]> => {
         if (!server.userId) {
            throw new Error("User ID is not set for read_resource");
        }
        console.log(`Reading resource: ${uri} for user: ${server.userId}`);

        const calendarService = await createCalendarService(server.userId, server.apiKey);
        const path = String(uri).replace('gcalendar:///', '');

        try {
            // Handle special case for upcoming events
            if (path === 'upcoming') {
                const timeMin = new Date().toISOString();
                const timeMax = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // Add 7 days

                const eventsResult = await calendarService.events.list({
                    calendarId: 'primary',
                    timeMin: timeMin,
                    timeMax: timeMax,
                    maxResults: 10,
                    singleEvents: true,
                    orderBy: 'startTime',
                });

                const events = eventsResult.data.items || [];
                const formattedEvents = events.map(formatEvent);

                let content = "Upcoming events in the next 7 days:\n\n";
                if (formattedEvents.length === 0) {
                    content += "No upcoming events found.\n";
                } else {
                    formattedEvents.forEach((event, i) => {
                        content += `${i + 1}. ${event.summary}\n`;
                        content += `   When: ${event.start} to ${event.end}\n`;
                        if (event.location !== "N/A") {
                            content += `   Where: ${event.location}\n`;
                        }
                        if (event.attendees && event.attendees.length > 0) {
                            content += `   Attendees: ${event.attendees.join(', ')}\n`;
                        }
                        content += "\n";
                    });
                }

                return [{ content: content, mimeType: 'text/plain' }];
            }

            // Otherwise, get events for a specific calendar
            const timeMin = new Date().toISOString(); // Look ahead from now

            const eventsResult = await calendarService.events.list({
                calendarId: path,
                timeMin: timeMin,
                maxResults: 10,
                singleEvents: true,
                orderBy: 'startTime',
            });

            const events = eventsResult.data.items || [];
            const formattedEvents = events.map(formatEvent);

            const calendarInfo = await calendarService.calendars.get({ calendarId: path });

            let content = `Calendar: ${calendarInfo.data.summary || 'Unknown'}\n\n`;
            content += "Upcoming events:\n\n";

            if (formattedEvents.length === 0) {
                content += "No upcoming events found for this calendar.\n";
            } else {
                formattedEvents.forEach((event, i) => {
                    content += `${i + 1}. ${event.summary}\n`;
                    content += `   ID: ${event.id}\n`;
                    content += `   When: ${event.start} to ${event.end}\n`;
                    if (event.location !== "N/A") content += `   Where: ${event.location}\n`;
                    if (event.description) content += `   Description: ${event.description}\n`;
                    if (event.attendees.length > 0) content += `   Attendees: ${event.attendees.join(', ')}\n`;
                    content += '\n';
                });
            }

             return [{ content: content, mimeType: 'text/plain' }];

        } catch (error: any) {
            console.error(`Error reading calendar resource ${uri}:`, error);
            const message = error.response?.data?.error?.message || error.message || 'Unknown error';
            return [{ content: `Error reading calendar: ${message}`, mimeType: 'text/plain' }];
        }
    });


    // --- Tool Handlers ---

    server.list_tools()(async (): Promise<Tool[]> => {
        if (!server.userId) {
            console.log("Listing tools without a user ID context.");
            // Depending on requirements, you might throw an error or return an empty list
            // throw new Error("User ID is not set for list_tools");
        } else {
             console.log(`Listing tools for user: ${server.userId}`);
        }

        return [
            {
                name: 'list_events',
                description: 'List events from Google Calendar for a specified time range',
                inputSchema: {
                    type: 'object',
                    properties: {
                        calendar_id: {
                            type: 'string',
                            description: 'Calendar ID (optional - defaults to primary)',
                        },
                        days: {
                            type: 'integer',
                            description: 'Number of days to look ahead (optional - defaults to 7)',
                        },
                        max_results: {
                            type: 'integer',
                            description: 'Maximum number of events to return (optional - defaults to 10)',
                        },
                    },
                    required: [], // No strictly required fields as they have defaults
                },
            },
            {
                name: 'create_event',
                description: 'Create a new event in Google Calendar',
                inputSchema: {
                    type: 'object',
                    properties: {
                        calendar_id: {
                            type: 'string',
                            description: 'Calendar ID (optional - defaults to primary)',
                        },
                        summary: { type: 'string', description: 'Event title' },
                        start_datetime: {
                            type: 'string',
                            description: 'Start date/time (format: YYYY-MM-DD HH:MM for specific time, YYYY-MM-DD for all-day)',
                        },
                        end_datetime: {
                            type: 'string',
                            description: 'End date/time (format: YYYY-MM-DD HH:MM for specific time, YYYY-MM-DD for all-day)',
                        },
                        description: {
                            type: 'string',
                            description: 'Event description (optional)',
                        },
                        location: {
                            type: 'string',
                            description: 'Event location (optional)',
                        },
                        attendees: {
                            type: 'array',
                            items: { type: 'string', format: 'email' },
                            description: 'List of attendee emails (optional)',
                        },
                    },
                    required: ['summary', 'start_datetime', 'end_datetime'],
                },
            },
            {
                name: 'update_event',
                description: 'Update an existing event in Google Calendar',
                inputSchema: {
                    type: 'object',
                    properties: {
                        calendar_id: {
                            type: 'string',
                            description: 'Calendar ID (optional - defaults to primary)',
                        },
                        event_id: {
                            type: 'string',
                            description: 'ID of the Event to update',
                        },
                        summary: {
                            type: 'string',
                            description: 'New event title (optional)',
                        },
                        start_datetime: {
                            type: 'string',
                            description: 'New start date/time (format: YYYY-MM-DD HH:MM or YYYY-MM-DD) (optional)',
                        },
                        end_datetime: {
                            type: 'string',
                            description: 'New end date/time (format: YYYY-MM-DD HH:MM or YYYY-MM-DD) (optional)',
                        },
                        description: {
                            type: 'string',
                            description: 'New event description (optional)',
                        },
                        location: {
                            type: 'string',
                            description: 'New event location (optional)',
                        },
                        attendees: {
                            type: 'array',
                            items: { type: 'string', format: 'email' },
                            description: 'New list of attendee emails (replaces existing) (optional)',
                        },
                    },
                    required: ['event_id'],
                },
            },
        ];
    });

    server.call_tool()(async (
        name: string,
        args: Record<string, any> | null
    ): Promise<Array<TextContent | ImageContent | EmbeddedResource>> => {
         if (!server.userId) {
            throw new Error(`User ID is not set for call_tool ${name}`);
        }
        const argumentsNonNull = args ?? {}; // Use empty object if args is null

        console.log(
            `User ${server.userId} calling tool: ${name} with arguments: ${JSON.stringify(argumentsNonNull)}`
        );

        const calendarService = await createCalendarService(server.userId, server.apiKey);

        try {
            if (name === 'list_events') {
                const calendarId = argumentsNonNull.calendar_id || 'primary';
                const days = parseInt(argumentsNonNull.days || '7', 10);
                const maxResults = parseInt(argumentsNonNull.max_results || '10', 10);

                const timeMin = new Date().toISOString();
                const timeMax = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

                const eventsResult = await calendarService.events.list({
                    calendarId: calendarId,
                    timeMin: timeMin,
                    timeMax: timeMax,
                    maxResults: maxResults,
                    singleEvents: true,
                    orderBy: 'startTime',
                });

                const events = eventsResult.data.items || [];
                const formattedEvents = events.map(formatEvent);

                let response = `Found ${formattedEvents.length} events in the next ${days} days on calendar '${calendarId}':\n\n`;

                if (formattedEvents.length === 0) {
                    response = `No events found in the next ${days} days on calendar '${calendarId}'.`;
                } else {
                    formattedEvents.forEach((event, i) => {
                        response += `${i + 1}. ${event.summary}\n`;
                        response += `   ID: ${event.id}\n`;
                        response += `   When: ${event.start} to ${event.end}\n`;
                        if (event.location !== 'N/A') response += `   Where: ${event.location}\n`;
                        if (event.description) response += `   Description: ${event.description}\n`;
                        if (event.attendees.length > 0) response += `   Attendees: ${event.attendees.join(', ')}\n`;
                        response += '\n';
                    });
                }
                return [{ type: 'text', text: response }];

            } else if (name === 'create_event') {
                 if (!argumentsNonNull.summary || !argumentsNonNull.start_datetime || !argumentsNonNull.end_datetime) {
                     throw new Error('Missing required parameters: summary, start_datetime, end_datetime');
                 }

                const calendarId = argumentsNonNull.calendar_id || 'primary';
                const {
                    summary,
                    start_datetime,
                    end_datetime,
                    description,
                    location,
                    attendees, // Expecting an array of emails
                 } = argumentsNonNull;

                const event: calendar_v3.Schema$Event = {
                    summary: summary,
                    description: description || undefined,
                    location: location || undefined,
                };

                // Handle dates/times - Google API expects specific formats
                const startHasTime = start_datetime.includes(' ');
                const endHasTime = end_datetime.includes(' ');

                // Basic validation for date/datetime formats
                const dateTimeRegex = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;
                const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

                if (startHasTime) {
                    if (!dateTimeRegex.test(start_datetime)) throw new Error("Invalid start_datetime format. Use 'YYYY-MM-DD HH:MM'");
                    event.start = { dateTime: new Date(start_datetime.replace(' ', 'T') + ':00Z').toISOString(), timeZone: 'UTC' }; // Assume UTC, convert to ISO
                } else {
                     if (!dateRegex.test(start_datetime)) throw new Error("Invalid start_datetime format. Use 'YYYY-MM-DD'");
                    event.start = { date: start_datetime };
                }

                if (endHasTime) {
                     if (!dateTimeRegex.test(end_datetime)) throw new Error("Invalid end_datetime format. Use 'YYYY-MM-DD HH:MM'");
                    event.end = { dateTime: new Date(end_datetime.replace(' ', 'T') + ':00Z').toISOString(), timeZone: 'UTC' }; // Assume UTC, convert to ISO
                } else {
                    if (!dateRegex.test(end_datetime)) throw new Error("Invalid end_datetime format. Use 'YYYY-MM-DD'");
                    event.end = { date: end_datetime };
                }

                if (attendees && Array.isArray(attendees) && attendees.length > 0) {
                    event.attendees = attendees.map((email: string) => ({ email }));
                }

                const createdEvent = await calendarService.events.insert({
                    calendarId: calendarId,
                    requestBody: event,
                });

                const formatted = formatEvent(createdEvent.data); // Format the response

                let response = `Event created successfully on calendar '${calendarId}'!\n`;
                response += `Title: ${formatted.summary}\n`;
                response += `When: ${formatted.start} to ${formatted.end}\n`;
                if (formatted.location !== 'N/A') response += `Location: ${formatted.location}\n`;
                if (formatted.description) response += `Description: ${formatted.description}\n`;
                if (formatted.attendees.length > 0) response += `Attendees: ${formatted.attendees.join(', ')}\n`;
                response += `\nEvent ID: ${formatted.id}`;
                response += `\nEvent Link: ${formatted.htmlLink || 'N/A'}`;

                return [{ type: 'text', text: response }];

            } else if (name === 'update_event') {
                if (!argumentsNonNull.event_id) {
                    throw new Error('Missing required parameter: event_id');
                }

                const calendarId = argumentsNonNull.calendar_id || 'primary';
                const eventId = argumentsNonNull.event_id;

                // First get the existing event to update it incrementally
                const existingEventResponse = await calendarService.events.get({
                    calendarId: calendarId,
                    eventId: eventId,
                });
                const eventToUpdate: calendar_v3.Schema$Event = existingEventResponse.data;

                // Update fields only if they are provided in the arguments
                if (argumentsNonNull.summary !== undefined) eventToUpdate.summary = argumentsNonNull.summary;
                if (argumentsNonNull.description !== undefined) eventToUpdate.description = argumentsNonNull.description;
                if (argumentsNonNull.location !== undefined) eventToUpdate.location = argumentsNonNull.location;

                 // Basic validation for date/datetime formats
                const dateTimeRegex = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;
                const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

                // Handle start date/time update
                if (argumentsNonNull.start_datetime !== undefined) {
                    const start_datetime = argumentsNonNull.start_datetime;
                    const startHasTime = start_datetime.includes(' ');
                     if (startHasTime) {
                        if (!dateTimeRegex.test(start_datetime)) throw new Error("Invalid start_datetime format. Use 'YYYY-MM-DD HH:MM'");
                        eventToUpdate.start = { dateTime: new Date(start_datetime.replace(' ', 'T') + ':00Z').toISOString(), timeZone: 'UTC' };
                    } else {
                        if (!dateRegex.test(start_datetime)) throw new Error("Invalid start_datetime format. Use 'YYYY-MM-DD'");
                        eventToUpdate.start = { date: start_datetime };
                        delete eventToUpdate.start?.dateTime; // Ensure dateTime is removed if switching to all-day
                        delete eventToUpdate.start?.timeZone;
                    }
                }

                 // Handle end date/time update
                if (argumentsNonNull.end_datetime !== undefined) {
                     const end_datetime = argumentsNonNull.end_datetime;
                    const endHasTime = end_datetime.includes(' ');
                    if (endHasTime) {
                         if (!dateTimeRegex.test(end_datetime)) throw new Error("Invalid end_datetime format. Use 'YYYY-MM-DD HH:MM'");
                        eventToUpdate.end = { dateTime: new Date(end_datetime.replace(' ', 'T') + ':00Z').toISOString(), timeZone: 'UTC' };
                    } else {
                         if (!dateRegex.test(end_datetime)) throw new Error("Invalid end_datetime format. Use 'YYYY-MM-DD'");
                        eventToUpdate.end = { date: end_datetime };
                        delete eventToUpdate.end?.dateTime; // Ensure dateTime is removed if switching to all-day
                        delete eventToUpdate.end?.timeZone;
                    }
                }

                // Handle attendees update (replaces existing list)
                if (argumentsNonNull.attendees !== undefined) {
                    const attendees = argumentsNonNull.attendees;
                    if (Array.isArray(attendees)) {
                         eventToUpdate.attendees = attendees.map((email: string) => ({ email }));
                    } else {
                        throw new Error("attendees parameter must be an array of email strings");
                    }
                }

                // Update the event
                const updatedEvent = await calendarService.events.update({
                    calendarId: calendarId,
                    eventId: eventId,
                    requestBody: eventToUpdate,
                });

                const formatted = formatEvent(updatedEvent.data);

                let response = `Event '${eventId}' updated successfully on calendar '${calendarId}'!\n`;
                response += `Title: ${formatted.summary}\n`;
                response += `When: ${formatted.start} to ${formatted.end}\n`;
                if (formatted.location !== 'N/A') response += `Location: ${formatted.location}\n`;
                if (formatted.description) response += `Description: ${formatted.description}\n`;
                if (formatted.attendees.length > 0) response += `Attendees: ${formatted.attendees.join(', ')}\n`;
                response += `\nEvent Link: ${formatted.htmlLink || 'N/A'}`;

                return [{ type: 'text', text: response }];

            } else {
                throw new Error(`Unknown tool: ${name}`);
            }
        } catch (error: any) {
            console.error(`Error executing tool ${name} for user ${server.userId}:`, error);
            // Try to get a meaningful error message from Google API response
            const message = error.response?.data?.error?.message || error.message || 'An unexpected error occurred';
            const errorMessage = `Error calling tool '${name}': ${message}`;
            return [{ type: 'text', text: errorMessage }];
        }
    });

    return server;
}

// Export the createServer function, assuming it's the primary export needed by the framework
export const server = createServer; // Changed from Python `server = create_server`

// Export the initialization options function
export function getInitializationOptions(serverInstance: Server): InitializationOptions {
    return {
        server_name: 'gcalendar-server',
        server_version: '1.0.0', // Update version as needed
        capabilities: serverInstance.get_capabilities({ // Call the method on the instance
            notification_options: {}, // Provide actual options if needed
            experimental_capabilities: {}, // Provide actual options if needed
        }),
    };
}


// --- Main Execution Block (for Auth command) ---
// Get the file path of the current module
const currentModulePath = fileURLToPath(import.meta.url);

// Get the file path of the script that was executed
// process.argv[0] is node executable, process.argv[1] is the script path
const mainScriptPath = process.argv[1];

// Resolve both paths to ensure they are absolute and comparable
const resolvedModulePath = path.resolve(currentModulePath);
const resolvedMainScriptPath = path.resolve(mainScriptPath);

// Check if the current module is the main script
if (resolvedModulePath === resolvedMainScriptPath) {
    const args = process.argv.slice(2); // Get command line arguments, excluding node and script path

    if (args.length > 0 && args[0].toLowerCase() === 'auth') {
        const userId = 'local'; // Or get from args[1] if needed: const userId = args[1] || 'local';
        console.log(`Running authentication flow for user: ${userId}`);

        // Run authentication flow - Ensure authenticateAndSaveCredentials is async if needed
        authenticateAndSaveCredentials(userId, SERVICE_NAME, SCOPES)
            .then(() => {
                console.log(`Authentication successful for ${userId}. Credentials saved.`);
                process.exit(0);
            })
            .catch((err) => {
                console.error(`Authentication failed for ${userId}:`, err);
                process.exit(1);
            });
    } else {
        console.log("Usage:");
        console.log("  node <script_name>.js auth [<user_id>] - Run authentication flow (defaults to user_id 'local')");
        console.log("\nNote: To run the server normally, use the guMCP server framework.");
        console.log("(Replace <script_name>.js with the compiled JS file name)");
    }
}