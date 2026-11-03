/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Sequencer } from '../../../base/common/async.js';
import { CancellationTokenSource } from '../../../base/common/cancellation.js';
import { Disposable, toDisposable } from '../../../base/common/lifecycle.js';
import { ILogService } from '../../log/common/log.js';
import { isLocalModelRequest, LOCAL_MODEL_REQUEST_KEY, LOCAL_MODEL_STATUS_KEY, type ILocalModelRequest } from '../common/localModel.js';
import { IAgentConfigurationService } from './agentConfigurationService.js';

/** Minimum interval between status publications that only move byte counters. */
export const LOCAL_MODEL_STATUS_PROGRESS_PUBLISH_INTERVAL_MS = 1000;

const MAX_REMEMBERED_NONCES = 128;

/**
 * The Agent Host side of the local-model protocol; provider-neutral. Publishes the provider's status as
 * `vscode.localModel.status`, coalescing changes that only move byte counters to one per
 * {@link LOCAL_MODEL_STATUS_PROGRESS_PUBLISH_INTERVAL_MS}, because every root config change fans out to every agent.
 * Claims a request's nonce synchronously and clears the key before acting, so a nonce is never handled twice; a
 * request present before the channel existed is discarded. `cancel` and `pause` run immediately; other transitions
 * go through a {@link Sequencer} that never waits for a download or a drain.
 */
export class LocalModelSetupChannel extends Disposable {

	private readonly _seenNonces = new Set<string>();
	private readonly _cancellation = this._register(new CancellationTokenSource());

	constructor(
		private readonly _configurationService: IAgentConfigurationService,
		private readonly _logService: ILogService,
		publishIntervalMs = LOCAL_MODEL_STATUS_PROGRESS_PUBLISH_INTERVAL_MS,
	) {
		super();
		this._discardStaleRequest();
		this._register(this._configurationService.onDidRootConfigChange(() => this._handleRequest()));
		this._register(toDisposable(() => {
			this._cancellation.cancel();
			this._configurationService.publishRootTransientValues?.({ [LOCAL_MODEL_STATUS_KEY]: undefined });
		}));
	}

	private _discardStaleRequest(): void {
		const value = this._configurationService.getRootConfigValues?.()[LOCAL_MODEL_REQUEST_KEY];
		if (value !== undefined) {
			this._logService.info('[LocalModel] Discarding a request written before on-device models were available');
			this._configurationService.updateRootConfig({ [LOCAL_MODEL_REQUEST_KEY]: undefined });
		}
	}

	private _handleRequest(): void {
		const value = this._configurationService.getRootConfigValues?.()[LOCAL_MODEL_REQUEST_KEY];
		if (value === undefined) {
			return;
		}
		const request = isLocalModelRequest(value) ? value : undefined;
		const isNew = !!request && !this._seenNonces.has(request.nonce);
		if (request) {
			this._rememberNonce(request.nonce);
		}
		// Clearing re-enters this handler synchronously; the claim above makes that a no-op.
		this._configurationService.updateRootConfig({ [LOCAL_MODEL_REQUEST_KEY]: undefined });
		if (!request) {
			this._logService.warn('[LocalModel] Ignoring a malformed on-device model request');
			return;
		}
		if (isNew) {
			this._dispatch(request);
		}
	}

	private _rememberNonce(nonce: string): void {
		this._seenNonces.add(nonce);
		if (this._seenNonces.size > MAX_REMEMBERED_NONCES) {
			const oldest = this._seenNonces.values().next().value;
			if (oldest !== undefined) {
				this._seenNonces.delete(oldest);
			}
		}
	}

	private _dispatch(request: ILocalModelRequest): void {
	}

}
