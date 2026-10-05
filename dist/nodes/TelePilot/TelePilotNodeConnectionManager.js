"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TelePilotNodeConnectionManager = exports.sleep = exports.ClientSession = exports.TelepilotAuthState = void 0;
require("reflect-metadata");
const typedi_1 = require("typedi");
const tdl = require('tdl');
const debug = require('debug')('telepilot-cm');
const fs = require('fs/promises');
const pjson = require('../../package.json');
const nodeVersion = pjson.version;
const binaryVersion = pjson.dependencies['@telepilotco/tdlib-binaries-prebuilt'].replace('^', '');
const addonVersion = pjson.dependencies['tdl'].replace('^', '');
var TelepilotAuthState;
(function (TelepilotAuthState) {
    TelepilotAuthState["NO_CONNECTION"] = "NO_CONNECTION";
    TelepilotAuthState["WAIT_TDLIB_PARAMS"] = "authorizationStateWaitTdlibParameters";
    TelepilotAuthState["WAIT_ENCRYPTION_KEY"] = "authorizationStateWaitEncryptionKey";
    TelepilotAuthState["WAIT_PHONE_NUMBER"] = "authorizationStateWaitPhoneNumber";
    TelepilotAuthState["WAIT_CODE"] = "authorizationStateWaitCode";
    TelepilotAuthState["WAIT_DEVICE_CONFIRMATION"] = "authorizationStateWaitOtherDeviceConfirmation";
    TelepilotAuthState["WAIT_REGISTRATION"] = "authorizationStateWaitRegistration";
    TelepilotAuthState["WAIT_PASSWORD"] = "authorizationStateWaitPassword";
    TelepilotAuthState["WAIT_READY"] = "authorizationStateReady";
    TelepilotAuthState["WAIT_LOGGING_OUT"] = "authorizationStateLoggingOut";
    TelepilotAuthState["WAIT_CLOSING"] = "authorizationStateClosing";
    TelepilotAuthState["WAIT_CLOSED"] = "authorizationStateClosed";
})(TelepilotAuthState = exports.TelepilotAuthState || (exports.TelepilotAuthState = {}));
function getEnumFromString(enumObj, str) {
    for (const key of Object.keys(enumObj)) {
        if (enumObj[key] === str) {
            return enumObj[key];
        }
    }
    return undefined;
}
class ClientSession {
    constructor(client, authState, phoneNumber) {
        this.client = client;
        this.authState = authState;
        this.phoneNumber = phoneNumber;
    }
}
exports.ClientSession = ClientSession;
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
exports.sleep = sleep;
let TelePilotNodeConnectionManager = class TelePilotNodeConnectionManager {
    constructor() {
        this.clientSessions = {};
        this.tdlConfigured = false;
        this.NODE_INSTALL_DIR = `${process.env.HOME}/.n8n/nodes/node_modules/@lesleyxyz/n8n-nodes-telepilot`;
        this.TD_DATABASE_PATH_PREFIX = `${this.NODE_INSTALL_DIR}/db`;
        this.TD_FILES_PATH_PREFIX = `${this.NODE_INSTALL_DIR}/db`;
    }
    async createClientSetAuthHandlerForPhoneNumberLogin(apiId, apiHash, phoneNumber) {
        if (this.clientSessions[apiId] === undefined) {
            const client = this.initClient(apiId, apiHash);
            this.clientSessions[apiId] = new ClientSession(client, TelepilotAuthState.NO_CONNECTION, phoneNumber);
        }
        const authHandler = (update) => {
            var _a;
            if (update._ === 'updateAuthorizationState') {
                debug('authHandler.Got updateAuthorizationState:', JSON.stringify(update, null, 2));
                const authorizationState = update.authorization_state;
                const session = this.clientSessions[apiId];
                if (session !== undefined) {
                    session.authState = (_a = getEnumFromString(TelepilotAuthState, authorizationState._)) !== null && _a !== void 0 ? _a : session.authState;
                    debug('set clientSession.authState to ' + session.authState);
                }
            }
        };
        this.clientSessions[apiId].client.on('update', authHandler);
        await sleep(1000);
        return this.clientSessions[apiId];
    }
    async closeLocalSession(apiId) {
        debug('closeLocalSession apiId:' + apiId);
        const clientSession = this.clientSessions[apiId];
        if (clientSession === undefined) {
            throw new Error('You need to login first, please check our guide at https://telepilot.co/login-howto');
        }
        clientSession.client.close();
        delete this.clientSessions[apiId];
        debug(Object.keys(this.clientSessions));
    }
    async deleteLocalInstance(apiId) {
        const clientSession = this.clientSessions[apiId];
        if (clientSession === undefined) {
            throw new Error('You need to login first, please check our guide at https://telepilot.co/login-howto');
        }
        try {
            await clientSession.client.invoke({ _: 'close' });
        }
        catch (e) {
            debug('Connection was already closed');
        }
        const result = {};
        const removeDir = async (dirPath) => {
            await fs.rm(dirPath, { recursive: true });
        };
        const dbDatabasePath = this.getTdDatabasePathForClient(apiId);
        await removeDir(dbDatabasePath);
        result['db_database'] = `Removed ${dbDatabasePath}`;
        const dbFilesPath = this.getTdFilesPathForClient(apiId);
        await removeDir(dbFilesPath);
        result['db_files'] = `Removed ${dbFilesPath}`;
        delete this.clientSessions[apiId];
        return result;
    }
    getTdDatabasePathForClient(apiId) {
        return `${this.TD_DATABASE_PATH_PREFIX}/${apiId}/_td_database`;
    }
    getTdFilesPathForClient(apiId) {
        return `${this.TD_FILES_PATH_PREFIX}/${apiId}/_td_files`;
    }
    async clientLoginWithPhoneNumber(apiId, phoneNumber) {
        debug('clientLoginWithPhoneNumber');
        const clientSession = this.clientSessions[apiId];
        if (clientSession === undefined) {
            throw new Error('You need to login first, please check our guide at https://telepilot.co/login-howto');
        }
        debug('clientLoginWithPhoneNumber.authState:' + clientSession.authState);
        if (clientSession.authState === TelepilotAuthState.WAIT_PHONE_NUMBER) {
            const result = await clientSession.client.invoke({
                _: 'setAuthenticationPhoneNumber',
                phone_number: phoneNumber,
            });
            return result;
        }
        return '';
    }
    async clientLoginSendAuthenticationCode(apiId, code) {
        debug('clientLoginSendAuthenticationCode');
        const clientSession = this.clientSessions[apiId];
        if (clientSession === undefined) {
            throw new Error('You need to login first, please check our guide at https://telepilot.co/login-howto');
        }
        const result = await clientSession.client.invoke({
            _: 'checkAuthenticationCode',
            code,
        });
        return result;
    }
    async clientLoginSendAuthenticationPassword(apiId, password) {
        debug('clientLoginSendAuthenticationPassword');
        const clientSession = this.clientSessions[apiId];
        if (clientSession === undefined) {
            throw new Error('You need to login first, please check our guide at https://telepilot.co/login-howto');
        }
        const result = await clientSession.client.invoke({
            _: 'checkAuthenticationPassword',
            password,
        });
        return result;
    }
    getAuthStateForCredential(apiId) {
        const clientSession = this.clientSessions[apiId];
        if (clientSession === undefined) {
            return TelepilotAuthState.NO_CONNECTION;
        }
        return clientSession.authState;
    }
    getAllClientSessions() {
        return Object.entries(this.clientSessions).map(([apiId, session]) => ({
            apiId,
            authState: session.authState,
            phoneNumber: session.phoneNumber,
        }));
    }
    markClientAsClosed(apiId) {
        debug('markClientAsClosed apiId:' + apiId);
        this.closeLocalSession(apiId);
    }
    initClient(apiId, apiHash) {
        const existingSession = this.clientSessions[apiId];
        if (existingSession !== undefined) {
            return existingSession.client;
        }
        const { libFolder, libFile } = this.locateBinaryModules();
        debug('nodeVersion:', nodeVersion);
        debug('binaryVersion:', binaryVersion);
        debug('addonVersion:', addonVersion);
        if (!this.tdlConfigured) {
            tdl.configure({
                libdir: libFolder,
                tdjson: libFile,
            });
            this.tdlConfigured = true;
        }
        return tdl.createClient({
            apiId,
            apiHash,
            databaseDirectory: this.getTdDatabasePathForClient(apiId),
            filesDirectory: this.getTdFilesPathForClient(apiId),
            nodeVersion,
            binaryVersion,
            addonVersion,
        });
    }
    locateBinaryModules() {
        const libPrebuiltPackage = 'tdlib-binaries-prebuilt/prebuilds/';
        const libFolder = `${__dirname}/../../../../../@telepilotco/${libPrebuiltPackage}`;
        let libFile = '';
        if (process.arch === 'x64') {
            switch (process.platform) {
                case 'linux':
                    libFile = 'libtdjson.so';
                    break;
                case 'win32':
                case 'darwin':
                    throw new Error('Your n8n installation is currently not supported, ' +
                        'please refer to https://telepilot.co/nodes/telepilot/');
                default:
                    throw new Error('Not implemented for ' + process.platform);
            }
        }
        else if (process.arch === 'arm64') {
            switch (process.platform) {
                case 'darwin':
                    libFile = 'libtdjson.dylib';
                    break;
                case 'linux':
                    libFile = 'libtdjson.so';
                    break;
                default:
                    throw new Error('Your n8n installation is currently not supported, ' +
                        'please refer to https://telepilot.co/nodes/telepilot/');
            }
        }
        return { libFolder, libFile };
    }
};
TelePilotNodeConnectionManager = __decorate([
    (0, typedi_1.Service)()
], TelePilotNodeConnectionManager);
exports.TelePilotNodeConnectionManager = TelePilotNodeConnectionManager;
//# sourceMappingURL=TelePilotNodeConnectionManager.js.map