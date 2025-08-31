#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';
import { Writable, Readable } from 'stream';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import promClient, { Counter, Gauge, register } from 'prom-client';

import { fileURLToPath } from 'url';    
// --- Basic Logging Setup ---
// More sophisticated logging (like pino, which fastify uses) can be integrated
const logger = {
    info: (...args: any[]) => console.log(`[INFO] ${new Date().toISOString()}:`, ...args),
    warn: (...args: any[]) => console.warn(`[WARN] ${new Date().toISOString()}:`, ...args),
    error: (...args: any[]) => console.error(`[ERROR] ${new Date().toISOString()}:`, ...args),
};

// --- Types and Interfaces ---
interface ServerInstance {
    // Assuming the server instance has a run method compatible with this signature
    run(readStream: Readable, writeStream: Writable, initOptions: any): Promise<void>;
    // Add other methods/properties if needed by getInitializationOptions or elsewhere
    userId?: string;
    apiKey?: string;
}

interface ServerModule {
    // Factory function or class constructor
    server: new (userId?: string, apiKey?: string) => ServerInstance | ((userId?: string, apiKey?: string) => ServerInstance);
    getInitializationOptions: (instance: ServerInstance) => any;
    // Allow other exports
    [key: string]: any;
}

interface DiscoveredServer {
    name: string;
    path: string;
    module?: ServerModule; // Loaded module
}

interface ServerInfo {
    serverFactory: ServerModule['server'];
    getInitializationOptions: ServerModule['getInitializationOptions'];
}

// --- Constants ---
const currentFilePath = fileURLToPath(import.meta.url);
const currentDirPath = path.dirname(currentFilePath);
const SERVERS_DIR = path.resolve(currentDirPath); // <-- Use the calculated path
const METRICS_PORT = 9091;

// --- State (for Remote Server) ---
const discoveredServers = new Map<string, ServerInfo>();
// Map sessionKey (serverName:userId:apiKey) to server instance
const userServerInstances = new Map<string, ServerInstance>();
// Map sessionKey to SSE connection (FastifyReply) and a way to push incoming messages
const userSessionTransports = new Map<string, { reply: FastifyReply; messageEmitter: Readable & { pushMessage: (msg: any) => void } }>();

// --- Prometheus Metrics ---
const activeConnections = new Gauge({
    name: 'gumcp_active_connections',
    help: 'Number of active SSE connections',
    labelNames: ['server'],
});
const connectionTotal = new Counter({
    name: 'gumcp_connection_total',
    help: 'Total number of SSE connections',
    labelNames: ['server'],
});

// --- Utility Functions ---

async function checkFileExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath, fs.constants.F_OK);
        return true;
    } catch (e) {
        return false;
    }
}

// --- Server Discovery and Loading ---

async function loadServerModule(serverName: string, serverDir: string): Promise<ServerModule | null> {
    const serverFile = path.join(serverDir, 'main.ts'); // Assuming compiled JS files
    // Or use main.ts if using ts-node or similar runtime compilation
    // const serverFile = path.join(serverDir, 'main.ts');

    if (!(await checkFileExists(serverFile))) {
        logger.warn(`Server main file not found for '${serverName}' at ${serverFile}`);
        return null;
    }

    try {
        // Use dynamic import to load the module
        const modulePath = path.resolve(serverFile);
        const serverModule = await import(modulePath) as Partial<ServerModule>;

        // Validate required exports
        if (typeof serverModule.server !== 'function' && typeof serverModule.server !== 'object') {
             throw new Error(`Module does not export a 'server' class or factory function.`);
        }
         if (typeof serverModule.getInitializationOptions !== 'function') {
             throw new Error(`Module does not export a 'getInitializationOptions' function.`);
         }


        logger.info(`Successfully loaded server module: ${serverName}`);
        return serverModule as ServerModule;
    } catch (error: any) {
        logger.error(`Failed to load server module '${serverName}' from ${serverFile}: ${error.message}`);
        if (error.stack) logger.error(error.stack);
        return null;
    }
}

async function discoverAndLoadServers(): Promise<Map<string, ServerInfo>> {
    const serversMap = new Map<string, ServerInfo>();
    logger.info(`Looking for servers in ${SERVERS_DIR}`);

    try {
        const entries = await fs.readdir(SERVERS_DIR, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isDirectory()) {
                const serverName = entry.name;
                const serverDirPath = path.join(SERVERS_DIR, serverName);
                const loadedModule = await loadServerModule(serverName, serverDirPath);
                console.log(serverName)
                console.log(serverDirPath)
                console.log(loadedModule)
                if (loadedModule) {
                    serversMap.set(serverName, {
                        serverFactory: loadedModule.server,
                        getInitializationOptions: loadedModule.getInitializationOptions,
                    });
                }
            }
        }
    } catch (error: any) {
        logger.error(`Error reading servers directory ${SERVERS_DIR}: ${error.message}`);
    }

    logger.info(`Discovered and loaded ${serversMap.size} servers: [${Array.from(serversMap.keys()).join(', ')}]`);
    return serversMap;
}

async function getServer(serverName: string): Promise<ServerInfo | null> {
     // Try loading on demand if not already discovered (useful for local mode)
     if (!discoveredServers.has(serverName)) {
         const serverDirPath = path.join(SERVERS_DIR, serverName);
         try {
             const stats = await fs.stat(serverDirPath);
             if (stats.isDirectory()) {
                 const loadedModule = await loadServerModule(serverName, serverDirPath);
                 if (loadedModule) {
                     const serverInfo = {
                         serverFactory: loadedModule.server,
                         getInitializationOptions: loadedModule.getInitializationOptions,
                     };
                     discoveredServers.set(serverName, serverInfo); // Cache it
                     return serverInfo;
                 }
             }
         } catch(e) {
             // Directory doesn't exist or other error, fall through to error
         }
     }
     return discoveredServers.get(serverName) || null;
 }

 // Helper function to create server instance
function createServerInstance(serverFactory: any, userId?: string, apiKey?: string): ServerInstance {
    if (typeof serverFactory !== 'function') {
        throw new Error('Invalid server factory');
    }
    
    if (serverFactory.prototype) {
        return new (serverFactory as new (userId?: string, apiKey?: string) => ServerInstance)(userId, apiKey);
    }
    
    return (serverFactory as (userId?: string, apiKey?: string) => ServerInstance)(userId, apiKey);
}

async function runStdioServer(serverInfo: ServerInfo, userId?: string) {
    logger.info(`Starting stdio server for ${userId || 'default user'}...`);

    const serverInstance = createServerInstance(serverInfo.serverFactory, userId);

    const initOptions = serverInfo.getInitializationOptions(serverInstance);

    // Replicate mcp.server.stdio behavior: pipe stdin/stdout
    // NOTE: The actual data format/protocol (JSON-RPC?) used over stdio
    // by the original `mcp` library needs to be implemented here or within
    // the server's `run` method based on how it consumes the streams.
    // This setup provides the raw streams.
    const readStream = process.stdin;
    const writeStream = process.stdout;

    logger.info('Connecting server to stdin/stdout.');

    try {
        await serverInstance.run(readStream, writeStream, initOptions);
        logger.info('Server run method finished.');
    } catch (error: any) {
        logger.error(`Stdio server instance crashed: ${error.message}`);
        if (error.stack) logger.error(error.stack);
        process.exitCode = 1; // Indicate error
    } finally {
        logger.info('Stdio server shutting down.');
        // Ensure streams are properly handled/closed if necessary, though stdin/stdout usually manage themselves.
    }
}

// --- Remote SSE/HTTP Server ---

// Creates a simple Readable stream that we can push messages into
function createMessageEmitter(): Readable & { pushMessage: (msg: any) => void } {
    const stream = new Readable({
        objectMode: true, // Assuming messages are objects/strings, adjust if binary
        read() { /* Will be pushed to externally */ }
    });
    // Attach the push method directly to the stream object for convenience
    (stream as any).pushMessage = (msg: any) => {
        stream.push(msg);
    };
    return stream as Readable & { pushMessage: (msg: any) => void };
}


async function runRemoteServer(host: string, port: number) {
    logger.info('Discovering servers for remote mode...');
    const loadedServers = await discoverAndLoadServers();
    if (loadedServers.size === 0) {
        logger.error("No servers found or loaded. Exiting.");
        process.exit(1);
    }
    // Store globally for access in routes
    loadedServers.forEach((info, name) => discoveredServers.set(name, info));


    const server: FastifyInstance = Fastify({ logger: true }); // Use Fastify's built-in Pino logger

    // --- Metrics Server Setup ---
    const metricsApp: FastifyInstance = Fastify();
    metricsApp.get('/metrics', async (request, reply) => {
        reply.header('Content-Type', register.contentType);
        reply.send(await register.metrics());
    });
    try {
        await metricsApp.listen({ port: METRICS_PORT, host });
        logger.info(`Metrics server listening on http://${host}:${METRICS_PORT}/metrics`);
    } catch (err) {
        logger.error(`Error starting metrics server: ${err}`);
        process.exit(1);
    }

    // --- Main Application Routes ---

    // Root and Health Check
    server.get('/', async (request, reply) => {
        return {
            status: 'ok',
            message: 'guMCP server running',
            servers: Array.from(discoveredServers.keys()),
        };
    });
    server.get('/health_check', async (request, reply) => {
        return { status: 'ok', servers: Array.from(discoveredServers.keys()) };
    });


    // Dynamically create routes for each discovered server
    discoveredServers.forEach((serverInfo, serverName) => {
        logger.info(`Setting up routes for server: ${serverName}`);

        // SSE Connection Endpoint
        server.get(`/${serverName}/:sessionKey`, async (request: FastifyRequest<{ Params: { sessionKey: string } }>, reply: FastifyReply) => {
            const { sessionKey: sessionKeyEncoded } = request.params;
            const sessionKey = `${serverName}:${sessionKeyEncoded}`; // Unique key for this server+user session

            let userId: string | undefined = undefined;
            let apiKey: string | undefined = undefined;

            // Basic parsing, adjust if sessionKey format is different
            if (sessionKeyEncoded.includes(':')) {
                [userId, apiKey] = sessionKeyEncoded.split(':', 2);
            } else {
                userId = sessionKeyEncoded;
            }

            logger.info(`SSE connection request for ${serverName}, User: ${userId ?? 'N/A'}`);

            // --- Get or Create Server Instance ---
            let serverInstance = userServerInstances.get(sessionKey);
            let isNewInstance = false;
            if (!serverInstance) {
                logger.info(`Creating new server instance for session: ${sessionKey}`);
                serverInstance = createServerInstance(serverInfo.serverFactory, userId, apiKey);
                userServerInstances.set(sessionKey, serverInstance);
                isNewInstance = true;
                activeConnections.labels(serverName).inc(); // Increment active count only for new sessions
            } else {
                logger.info(`Reusing existing server instance for session: ${sessionKey}`);
            }
            connectionTotal.labels(serverName).inc(); // Increment total count always

            // --- Set up SSE Headers ---
             reply.raw.writeHead(200, {
                 'Content-Type': 'text/event-stream',
                 'Cache-Control': 'no-cache',
                 'Connection': 'keep-alive',
                 // Add CORS headers if needed, e.g., from a browser client
                 'Access-Control-Allow-Origin': '*',
             });
             // Send initial OK or comment to establish connection
             reply.raw.write(': connection established\n\n');


            // --- Create Communication Streams ---
            // Write Stream: Sends data TO the client via SSE
            const writeStream = new Writable({
                objectMode: true, // Assume we're writing strings or JSON stringified data
                write(chunk, encoding, callback) {
                    try {
                        // Format as SSE 'data' event
                        const dataString = typeof chunk === 'string' ? chunk : JSON.stringify(chunk);
                        const lines = dataString.split('\n').map(line => `data: ${line}`).join('\n');
                         if (!reply.raw.writableEnded) {
                            reply.raw.write(`${lines}\n\n`); // SSE message format
                            callback();
                         } else {
                            callback(new Error("Cannot write to closed SSE stream"));
                         }
                    } catch (err: any) {
                        callback(err);
                    }
                }
            });

             // Read Stream: Receives data FROM the client (via POST endpoint)
             const readStream = createMessageEmitter();


             // --- Store Transport ---
             userSessionTransports.set(sessionKey, { reply, messageEmitter: readStream });


            // --- Handle Connection Closing ---
            request.raw.on('close', () => {
                logger.info(`SSE connection closed for session: ${sessionKey}`);
                // Clean up transport
                userSessionTransports.delete(sessionKey);
                activeConnections.labels(serverName).dec();

                // Optional: Decide if server instance should be cleaned up
                // If state needs to persist across disconnects, keep it.
                // If not, uncomment below:
                 // userServerInstances.delete(sessionKey);
                 // logger.info(`Cleaned up server instance for session: ${sessionKey}`);

                // Ensure streams are ended/destroyed to prevent leaks
                readStream.destroy();
                writeStream.end(); // Or destroy(), depending on desired behavior
            });

            // --- Run the Server Logic ---
            try {
                const initOptions = serverInfo.getInitializationOptions(serverInstance);
                logger.info(`Running server instance for session: ${sessionKey}`);
                // Run the server's main logic loop, providing the streams
                 await serverInstance.run(readStream, writeStream, initOptions);
                 logger.info(`Server run finished for session: ${sessionKey}`);
                 // If run finishes without error, maybe close the connection gracefully?
                 if (!reply.raw.writableEnded) {
                     reply.raw.end();
                 }

            } catch (error: any) {
                logger.error(`Server instance crashed for session ${sessionKey}: ${error.message}`);
                if (error.stack) logger.error(error.stack);
                 if (!reply.raw.writableEnded) {
                     try {
                        // Send an error event before closing
                         reply.raw.write(`event: error\ndata: ${JSON.stringify({ message: "Internal server error" })}\n\n`);
                         reply.raw.end();
                     } catch (e) { /* ignore errors during error reporting */}
                 }
            } finally {
                 // Ensure cleanup happens even if run() throws sync error before 'close' event fires
                 if(userSessionTransports.has(sessionKey)) {
                     userSessionTransports.delete(sessionKey);
                     activeConnections.labels(serverName).dec(); // Ensure decrement if not closed via event
                 }
                 readStream.destroy();
                 writeStream.end();
             }
        });


        // Message Posting Endpoint (Client -> Server)
        server.post(`/${serverName}/:sessionKey/messages`, async (request: FastifyRequest<{ Params: { sessionKey: string }, Body: any }>, reply: FastifyReply) => {
            const { sessionKey: sessionKeyEncoded } = request.params;
            const sessionKey = `${serverName}:${sessionKeyEncoded}`;

            const transport = userSessionTransports.get(sessionKey);

            if (!transport) {
                reply.code(404).send({ error: 'Session not found or expired' });
                return;
            }

            try {
                // Push the received message body into the server's read stream
                transport.messageEmitter.pushMessage(request.body);
                reply.code(202).send({ status: 'accepted' }); // Accepted for processing
            } catch (error: any) {
                logger.error(`Error handling posted message for ${sessionKey}: ${error.message}`);
                reply.code(500).send({ error: 'Failed to process message' });
            }
        });
    });

    // --- Start the Main Server ---
    try {
        await server.listen({ port, host });
        // logger is automatically used by fastify now
        // logger.info(`Main guMCP server listening on http://${host}:${port}`);
    } catch (err) {
        server.log.error(err); // Use fastify logger
        process.exit(1);
    }
}

// --- Main Execution ---

async function main() {
    const argv = await yargs(hideBin(process.argv))
        .command(
            'local',
            'Run a server using stdio',
            (yargs) => {
                return yargs
                    .option('server', {
                        alias: 's',
                        type: 'string',
                        description: 'Name of the server to run (directory name in ./servers)',
                        required: true,
                    })
                    .option('user-id', {
                        alias: 'u',
                        type: 'string',
                        description: 'User ID for server context',
                        default: 'local',
                    });
            },
            async (argv) => {
                logger.info(`Starting guMCP local stdio server for server: ${argv.server}`);
                const serverInfo = await getServer(argv.server);
                if (!serverInfo) {
                    logger.error(`Server '${argv.server}' not found or failed to load.`);
                    // List available servers
                    try {
                        const entries = await fs.readdir(SERVERS_DIR, { withFileTypes: true });
                        const available = entries.filter(e => e.isDirectory()).map(e => e.name);
                        logger.info(`Available servers: ${available.join(', ')}`);
                    } catch { /* ignore inability to list */ }
                    process.exit(1);
                }
                await runStdioServer(serverInfo, argv.userId);
            }
        )
        .command(
            'remote',
            'Run the remote SSE/HTTP server',
            (yargs) => {
                return yargs
                    .option('host', {
                        type: 'string',
                        default: '0.0.0.0',
                        description: 'Host to bind the server to',
                    })
                    .option('port', {
                        type: 'number',
                        default: 8000,
                        description: 'Port to bind the server to',
                    });
            },
            async (argv) => {
                 logger.info(`Starting guMCP remote server on ${argv.host}:${argv.port}`);
                 await runRemoteServer(argv.host, argv.port);
            }
        )
        .demandCommand(1, 'Please specify a mode: local or remote')
        .strict()
        .help()
        .alias('help', 'h')
        .parse();
}

main().catch((error) => {
    logger.error('Unhandled error in main execution:', error);
    process.exit(1);
});