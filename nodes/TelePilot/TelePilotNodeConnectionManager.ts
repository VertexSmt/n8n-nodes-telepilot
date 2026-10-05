import 'reflect-metadata';
import { Service } from 'typedi';
import type { IDataObject } from 'n8n-workflow';
import type { Client } from 'tdl';

const tdl = require('tdl');

const debug = require('debug')('telepilot-cm');

const fs = require('fs/promises');

const pjson = require('../../package.json');

const nodeVersion: string = pjson.version;
const binaryVersion: string = (pjson.dependencies['@telepilotco/tdlib-binaries-prebuilt'] as string).replace('^', '');
const addonVersion: string = (pjson.dependencies['tdl'] as string).replace('^', '');

/**
 * All possible states of the TelePilot (TDLib-based) client session,
 * mirroring TDLib's `authorizationState*` objects.
 */
export enum TelepilotAuthState {
	NO_CONNECTION = 'NO_CONNECTION',
	WAIT_TDLIB_PARAMS = 'authorizationStateWaitTdlibParameters',
	WAIT_ENCRYPTION_KEY = 'authorizationStateWaitEncryptionKey',
	WAIT_PHONE_NUMBER = 'authorizationStateWaitPhoneNumber',
	WAIT_CODE = 'authorizationStateWaitCode',
	WAIT_DEVICE_CONFIRMATION = 'authorizationStateWaitOtherDeviceConfirmation',
	WAIT_REGISTRATION = 'authorizationStateWaitRegistration',
	WAIT_PASSWORD = 'authorizationStateWaitPassword',
	WAIT_READY = 'authorizationStateReady',
	WAIT_LOGGING_OUT = 'authorizationStateLoggingOut',
	WAIT_CLOSING = 'authorizationStateClosing',
	WAIT_CLOSED = 'authorizationStateClosed',
}

/**
 * Resolves an enum member by its string value, or returns undefined.
 */
function getEnumFromString(enumObj: Record<string, string>, str: string): TelepilotAuthState | undefined {
	for (const key of Object.keys(enumObj)) {
		if (enumObj[key] === str) {
			return enumObj[key] as TelepilotAuthState;
		}
	}
	return undefined;
}

/**
 * Wraps a single tdl Client together with its current authorization state
 * and the phone number it belongs to.
 */
export class ClientSession {
	client: Client;
	authState: TelepilotAuthState;
	phoneNumber: string;

	constructor(client: Client, authState: TelepilotAuthState, phoneNumber: string) {
		this.client = client;
		this.authState = authState;
		this.phoneNumber = phoneNumber;
	}
}

export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Singleton (via typedi) that owns all live TDLib client sessions, keyed by apiId.
 * Both the TelePilot node and the TelePilot Trigger node share this manager,
 * so one logged-in session can be reused across workflow executions.
 */
@Service()
export class TelePilotNodeConnectionManager {
	private clientSessions: Record<number, ClientSession> = {};
	private tdlConfigured = false;

	private readonly NODE_INSTALL_DIR = `${process.env.HOME}/.n8n/nodes/node_modules/@lesleyxyz/n8n-nodes-telepilot`;
	private readonly TD_DATABASE_PATH_PREFIX = `${this.NODE_INSTALL_DIR}/db`;
	private readonly TD_FILES_PATH_PREFIX = `${this.NODE_INSTALL_DIR}/db`;

	/**
	 * Returns the ClientSession stored for the given credential, creating and
	 * wiring up an `updateAuthorizationState` handler if it does not exist yet.
	 */
	async createClientSetAuthHandlerForPhoneNumberLogin(
		apiId: number,
		apiHash: string,
		phoneNumber: string,
	): Promise<ClientSession> {
		if (this.clientSessions[apiId] === undefined) {
			const client = this.initClient(apiId, apiHash);
			this.clientSessions[apiId] = new ClientSession(client, TelepilotAuthState.NO_CONNECTION, phoneNumber);
		}

		const authHandler = (update: IDataObject) => {
			if (update._ === 'updateAuthorizationState') {
				debug('authHandler.Got updateAuthorizationState:', JSON.stringify(update, null, 2));
				const authorizationState = update.authorization_state as IDataObject;
				const session = this.clientSessions[apiId];
				if (session !== undefined) {
					session.authState = getEnumFromString(TelepilotAuthState, authorizationState._ as string) ?? session.authState;
					debug('set clientSession.authState to ' + session.authState);
				}
			}
		};

		this.clientSessions[apiId].client.on('update', authHandler);

		// Give TDLib a moment to emit the initial authorization state update.
		await sleep(1000);
		return this.clientSessions[apiId];
	}

	/**
	 * Closes the local client session (without deleting the TDLib database).
	 */
	async closeLocalSession(apiId: number): Promise<void> {
		debug('closeLocalSession apiId:' + apiId);
		const clientSession = this.clientSessions[apiId];
		if (clientSession === undefined) {
			throw new Error('You need to login first, please check our guide at https://telepilot.co/login-howto');
		}
		clientSession.client.close();
		delete this.clientSessions[apiId];
		debug(Object.keys(this.clientSessions));
	}

	/**
	 * Closes the client and wipes the local TDLib database/files for this account,
	 * forcing a fresh login next time.
	 */
	async deleteLocalInstance(apiId: number): Promise<Record<string, string>> {
		const clientSession = this.clientSessions[apiId];
		if (clientSession === undefined) {
			throw new Error('You need to login first, please check our guide at https://telepilot.co/login-howto');
		}

		try {
			await clientSession.client.invoke({ _: 'close' });
		} catch (e) {
			debug('Connection was already closed');
		}

		const result: Record<string, string> = {};
		const removeDir = async (dirPath: string) => {
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

	getTdDatabasePathForClient(apiId: number): string {
		return `${this.TD_DATABASE_PATH_PREFIX}/${apiId}/_td_database`;
	}

	getTdFilesPathForClient(apiId: number): string {
		return `${this.TD_FILES_PATH_PREFIX}/${apiId}/_td_files`;
	}

	/**
	 * Step 1 of login flow: submits the phone number when TDLib awaits it.
	 */
	async clientLoginWithPhoneNumber(apiId: number, phoneNumber: string): Promise<string> {
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
			return result as unknown as string;
		}
		return '';
	}

	/**
	 * Step 2 of login flow: submits the confirmation code received via Telegram.
	 */
	async clientLoginSendAuthenticationCode(apiId: number, code: string): Promise<string> {
		debug('clientLoginSendAuthenticationCode');
		const clientSession = this.clientSessions[apiId];
		if (clientSession === undefined) {
			throw new Error('You need to login first, please check our guide at https://telepilot.co/login-howto');
		}
		const result = await clientSession.client.invoke({
			_: 'checkAuthenticationCode',
			code,
		});
		return result as unknown as string;
	}

	/**
	 * Step 3 of login flow (only when MFA is enabled): submits the cloud password.
	 */
	async clientLoginSendAuthenticationPassword(apiId: number, password: string): Promise<string> {
		debug('clientLoginSendAuthenticationPassword');
		const clientSession = this.clientSessions[apiId];
		if (clientSession === undefined) {
			throw new Error('You need to login first, please check our guide at https://telepilot.co/login-howto');
		}
		const result = await clientSession.client.invoke({
			_: 'checkAuthenticationPassword',
			password,
		});
		return result as unknown as string;
	}

	getAuthStateForCredential(apiId: number): TelepilotAuthState {
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

	markClientAsClosed(apiId: number) {
		debug('markClientAsClosed apiId:' + apiId);
		this.closeLocalSession(apiId);
	}

	/**
	 * Creates (or reuses) a tdl client configured with prebuilt TDLib binaries
	 * and per-account database/files directories.
	 */
	private initClient(apiId: number, apiHash: string): Client {
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
			// useTestDc: true
		}) as Client;
	}

	/**
	 * Locates the prebuilt libtdjson binary for the current platform/architecture.
	 * Windows and macOS x64 installations are currently unsupported.
	 */
	private locateBinaryModules(): { libFolder: string; libFile: string } {
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
					throw new Error(
						'Your n8n installation is currently not supported, ' +
							'please refer to https://telepilot.co/nodes/telepilot/',
					);
				default:
					throw new Error('Not implemented for ' + process.platform);
			}
		} else if (process.arch === 'arm64') {
			switch (process.platform) {
				case 'darwin':
					libFile = 'libtdjson.dylib';
					break;
				case 'linux':
					libFile = 'libtdjson.so';
					break;
				default:
					throw new Error(
						'Your n8n installation is currently not supported, ' +
							'please refer to https://telepilot.co/nodes/telepilot/',
					);
			}
		}

		return { libFolder, libFile };
	}
}
