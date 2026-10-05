import 'reflect-metadata';
import type { Client } from 'tdl';
export declare enum TelepilotAuthState {
    NO_CONNECTION = "NO_CONNECTION",
    WAIT_TDLIB_PARAMS = "authorizationStateWaitTdlibParameters",
    WAIT_ENCRYPTION_KEY = "authorizationStateWaitEncryptionKey",
    WAIT_PHONE_NUMBER = "authorizationStateWaitPhoneNumber",
    WAIT_CODE = "authorizationStateWaitCode",
    WAIT_DEVICE_CONFIRMATION = "authorizationStateWaitOtherDeviceConfirmation",
    WAIT_REGISTRATION = "authorizationStateWaitRegistration",
    WAIT_PASSWORD = "authorizationStateWaitPassword",
    WAIT_READY = "authorizationStateReady",
    WAIT_LOGGING_OUT = "authorizationStateLoggingOut",
    WAIT_CLOSING = "authorizationStateClosing",
    WAIT_CLOSED = "authorizationStateClosed"
}
export declare class ClientSession {
    client: Client;
    authState: TelepilotAuthState;
    phoneNumber: string;
    constructor(client: Client, authState: TelepilotAuthState, phoneNumber: string);
}
export declare function sleep(ms: number): Promise<void>;
export declare class TelePilotNodeConnectionManager {
    private clientSessions;
    private tdlConfigured;
    private readonly NODE_INSTALL_DIR;
    private readonly TD_DATABASE_PATH_PREFIX;
    private readonly TD_FILES_PATH_PREFIX;
    createClientSetAuthHandlerForPhoneNumberLogin(apiId: number, apiHash: string, phoneNumber: string): Promise<ClientSession>;
    closeLocalSession(apiId: number): Promise<void>;
    deleteLocalInstance(apiId: number): Promise<Record<string, string>>;
    getTdDatabasePathForClient(apiId: number): string;
    getTdFilesPathForClient(apiId: number): string;
    clientLoginWithPhoneNumber(apiId: number, phoneNumber: string): Promise<string>;
    clientLoginSendAuthenticationCode(apiId: number, code: string): Promise<string>;
    clientLoginSendAuthenticationPassword(apiId: number, password: string): Promise<string>;
    getAuthStateForCredential(apiId: number): TelepilotAuthState;
    getAllClientSessions(): {
        apiId: string;
        authState: TelepilotAuthState;
        phoneNumber: string;
    }[];
    markClientAsClosed(apiId: number): void;
    private initClient;
    private locateBinaryModules;
}
