import { Container } from 'typedi';

import type {
	IDataObject,
	INodeType,
	INodeTypeDescription,
	ITriggerFunctions,
	ITriggerResponse,
} from 'n8n-workflow';

const debug = require('debug')('telepilot-trigger');

import { TelePilotNodeConnectionManager, TelepilotAuthState } from './TelePilotNodeConnectionManager';
import { TDLibUpdateEvents } from './tdlib/updateEvents';
import type { TDLibUpdate } from './tdlib/types';
import type { Client } from 'tdl';

export class TelePilotTrigger implements INodeType {
	description: INodeTypeDescription = {
		// Basic node details will go here
		displayName: 'Telegram CoPilot Trigger',
		name: 'telePilotTrigger',
		icon: 'file:TelePilot.svg',
		group: ['trigger'],
		version: 1,
		description: 'Your Personal Telegram CoPilot Listener',
		defaults: {
			name: 'TelePilot Trigger',
		},
		inputs: [],
		outputs: ['main'],
		credentials: [
			{
				name: 'telePilotApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Events',
				name: 'events',
				type: 'multiOptions',
				options: [
					{
						name: '*',
						value: '*',
					},
					...TDLibUpdateEvents
				],
				default: ['updateNewMessage', 'updateMessageContent'],
			},
			{
				displayName: 'Options',
				name: 'options',
				type: 'collection',
				placeholder: 'Add option',
				default: {},
				options: [
					{
						displayName: 'Ignore Groups Events',
						description: 'Whether to ignore events for negative chat_ids',
						name: 'ignoreGroups',
						type: 'boolean',
						default: false,
					}
				]
			}
		],
	};
	// The execute method will go here

	async trigger(this: ITriggerFunctions): Promise<ITriggerResponse> {
		const credentials = await this.getCredentials('telePilotApi');

		const cM = Container.get(TelePilotNodeConnectionManager);

		const clientSession = await cM.createClientSetAuthHandlerForPhoneNumberLogin(
			credentials?.apiId as number,
			credentials?.apiHash as string,
			credentials?.phoneNumber as string,
		);
		debug('trigger.clientSession.authState: ' + clientSession.authState);
		if (clientSession.authState !== TelepilotAuthState.WAIT_READY) {
			await cM.closeLocalSession(credentials?.apiId as number);
			this.emit([
				this.helpers.returnJsonArray([
					{
						error:
							'Telegram account not logged in. ' +
							'Please use ChatTrigger node together with loginWithPhoneNumber action. ' +
							'Please check our guide at https://telepilot.co/login-howto',
					},
				]),
			]);
		}

		const client: Client = clientSession.client;

		const updateEventsArray = this.getNodeParameter('events', '') as string[];
		const options = this.getNodeParameter('options', {}) as {
			ignoreGroups?: boolean;
		};

		const emit = (data: IDataObject) => {
			this.emit([this.helpers.returnJsonArray([data])]);
		};

		/**
		 * Returns true if the incoming TDLib update should be delivered to the workflow.
		 */
		const shouldEmitUpdate = (update: IDataObject | TDLibUpdate): boolean => {
			const incomingEvent = update._ as string;
			const eventSelected = updateEventsArray.includes(incomingEvent) || updateEventsArray.length === 0;
			if (!eventSelected) {
				return false;
			}
			if (options.ignoreGroups) {
				const msg = update.message as TDLibUpdate['message'];
				const chatId = typeof msg === 'object' && msg !== null ? msg.chat_id : undefined;
				if (typeof chatId === 'number' && chatId < 0) {
					// Negative chat ids belong to groups/channels
					return false;
				}
			}
			return true;
		};

		const listener = (update: IDataObject) => {
			if (shouldEmitUpdate(update)) {
				debug('Got update: ' + JSON.stringify(update, null, 2));
				emit(update);
			}
		};

		if (this.getMode() !== 'manual') {
			client.on('update', listener);
			client.on('error', debug);
		}

		const closeFunction = async () => {
			debug('closeFunction(' + updateEventsArray + ')');
			client.removeListener('update', listener);
		};

		const manualTriggerFunction = async () => {
			await new Promise<void>((resolve, reject) => {
				const timeoutHandler = setTimeout(() => {
					client.removeListener('update', manualListener);
					reject(
						new Error(
							'Aborted, no message received within 30secs. This 30sec timeout is only set for "manually triggered execution". Active Workflows will listen indefinitely.',
						),
					);
				}, 30000);

				const manualListener = (update: IDataObject) => {
					if (shouldEmitUpdate(update)) {
						debug('Got update in manual: ' + JSON.stringify(update, null, 2));
						emit(update);

						clearTimeout(timeoutHandler);
						client.removeListener('update', manualListener);
						resolve();
					}
				};
				client.on('update', manualListener);
			});
		};

		return {
			closeFunction,
			manualTriggerFunction,
		};
	}
}
