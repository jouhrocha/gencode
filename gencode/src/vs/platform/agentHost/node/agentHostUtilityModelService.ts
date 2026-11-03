/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../instantiation/common/instantiation.js';
import { type ModelSelection, type URI as ProtocolURI } from '../common/state/sessionState.js';

/** The session, and optionally the chat, whose selected main agent model a utility request serves. */
export interface IAgentHostUtilityModelContext {
	readonly session: ProtocolURI;
	/** Defaults to the session's default chat. */
	readonly chat?: ProtocolURI;
	/**
	 * The model selected for the turn being served, when the caller runs before
	 * the provider has applied it (for example, titling a turn at admission).
	 */
	readonly model?: ModelSelection;
}

export const enum AgentHostUtilityModelUnavailableReason {
	/** The Copilot utility model is selected but no Copilot token is available. */
	CopilotSignInRequired = 'copilotSignInRequired',
	/** The main agent model is BYOK and the BYOK default is `none`. */
	NotConfigured = 'notConfigured',
	/**
	 * A BYOK model is selected (as the main agent model or the utility model
	 * override) but cannot be reached, for example because the renderer that
	 * serves BYOK models is disconnected.
	 */
	ByokModelUnavailable = 'byokModelUnavailable',
}

/** Thrown when no utility model can serve a request; callers map {@link reason} to user-facing text. */
export class AgentHostUtilityModelUnavailableError extends Error {
	constructor(readonly reason: AgentHostUtilityModelUnavailableReason) {
		super(`No utility model is available: ${reason}`);
		this.name = 'AgentHostUtilityModelUnavailableError';
	}
}

export const IAgentHostUtilityModelService = createDecorator<IAgentHostUtilityModelService>('agentHostUtilityModelService');

/**
 * Runs the host's small utility completions (titles, pull request text) on the
 * model the user configured, matching the Copilot Chat extension's
 * `copilot-utility-small` resolution:
 *
 * 1. A resolvable BYOK `utilitySmallModel` override.
 * 2. When the chat's selected main agent model is BYOK, `byokUtilityModelDefault`:
 *    the main agent model, no model, or the Copilot default.
 * 3. The Copilot default utility model.
 *
 * Only an agent host with a renderer BYOK bridge (the local utility-process
 * host) honors steps 1 and 2. Remote hosts always use the Copilot default and
 * ignore the utility model root config, even when a client writes it.
 *
 * BYOK selections fail closed: while no renderer serves BYOK models, a BYOK
 * override or BYOK main agent model makes the request fail instead of
 * falling back to Copilot, even when `byokUtilityModelDefault` is `copilot`.
 * The user chose to keep that chat's content on their own model, and the
 * Copilot route must not be reached only because the bridge is unavailable.
 */
export interface IAgentHostUtilityModelService {
	readonly _serviceBrand: undefined;
}

export class AgentHostUtilityModelService implements IAgentHostUtilityModelService {

	declare readonly _serviceBrand: undefined;

	constructor(
	) { }
}
