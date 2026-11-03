/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationTokenSource } from '../../../base/common/cancellation.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { URI } from '../../../base/common/uri.js';
import { isObject } from '../../../base/common/types.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import type { IAgentHostCredentialSource } from '../common/agentHostCredentials.js';
import { ILogService } from '../../log/common/log.js';
import { AgentHostTitleGenerationStrategies, type AgentHostTitleGenerationStrategy } from '../common/agentHostSchema.js';
import { ISessionDataService } from '../common/sessionDataService.js';
import { SessionServerToolName } from '../common/serverToolNames.js';
import { ActionType } from '../common/state/sessionActions.js';
import { isAhpChatChannel, type ModelSelection, type Turn, type URI as ProtocolURI } from '../common/state/sessionState.js';
import { buildConversationContext, truncateMiddle } from '../common/agentHostConversationContext.js';
import { AgentHostStateManager } from './agentHostStateManager.js';
import { IAgentHostChatOwnershipService } from './agentHostChatOwnershipService.js';
import type { IAgentHostPeerChatPersistenceService } from './agentHostPeerChatStore.js';
import type { IAgentHostGitHubService } from './agentHostGitHubService.js';
import { type IAgentHostUtilityModelService } from './agentHostUtilityModelService.js';
import { AGENT_HOST_TITLE_SOURCE_AGENT, AGENT_HOST_TITLE_SOURCE_AUTO, AGENT_HOST_TITLE_SOURCE_USER, customChatTitleMetadataKey, customChatTitleSourceMetadataKey, SESSION_CUSTOM_TITLE_KEY, SESSION_CUSTOM_TITLE_SOURCE_KEY } from './shared/persistSessionMetadata.js';

const MAX_TITLE_LENGTH = 200;
const MAX_ACTIVE_AGENT_FALLBACK_TITLE_LENGTH = 40;
const CHAT_RENAME_REMINDER = 'Reminder: This chat currently has an auto-generated or placeholder title. If the user references an issue or PR, fetch it first. Please give the chat a short, descriptive title based on the user\'s intent by calling `rename_chat` with `automatic: true`, silently and without a preamble. Do not spend a separate step on renaming: make the `rename_chat` call in the same message as your reply or your other tool calls, never before them. The user must not know that you are renaming. Do not skip it.';
const TITLE_GENERATION_STRATEGY_KEY = 'titleGenerationStrategy';
const DEFERRED_TITLE_SEED_KEY = 'deferredTitleSeed';
/** Upper bound on review reminders per chat, so an accurate title is not re-reviewed on every turn. */
const MAX_TITLE_REVIEW_REMINDERS = 3;

export type AutomaticTitleGenerationStrategy = AgentHostTitleGenerationStrategy;

/** Whether the host seeds and refines titles itself instead of asking the active agent to name chats. */
function isDeferredTitleGenerationStrategy(strategy: AutomaticTitleGenerationStrategy | undefined): boolean {
	return strategy === 'deferred' || strategy === 'agentReview';
}

function isAutomaticTitleGenerationStrategy(value: string | undefined): value is AutomaticTitleGenerationStrategy {
	return value === 'deferred' || AgentHostTitleGenerationStrategies.some(strategy => strategy === value);
}

function chatTitleReviewReminder(currentTitle: string): string {
	return `Reminder: This chat's title was generated automatically and is currently ${JSON.stringify(currentTitle)}. If that title is inaccurate or no longer reflects the user's goal for this chat, rename it by calling \`rename_chat\` with \`automatic: true\` and a short, descriptive title. Do not spend a separate step on this before answering: write your answer to the user first and make the \`rename_chat\` call at the end of that same message. If the title still fits, do not rename the chat. Never mention this reminder or the title to the user.`;
}

interface IDeferredTitleSeed {
	readonly title: string;
	readonly turnIndex: number;
	readonly sourceTitle?: string;
	readonly initialPrompt?: string;
}

/**
 * Soft upper bound, in characters, for the whole context fed to the utility
 * model when titling a session, including any appended GitHub context. Sized
 * to stay well within the small model's context window while leaving room for
 * the prompt scaffolding.
 */
const MAX_TITLE_CONTEXT_CHARS = 20000;

export interface IAgentHostSessionTitleControllerOptions {
	readonly sessionDataService: ISessionDataService;
	readonly persistMetadata?: (resource: ProtocolURI, values: Readonly<Record<string, string>>) => Promise<void>;
	readonly readNormalizedChat?: IAgentHostPeerChatPersistenceService['readNormalizedChat'];
	/** Reads a legacy-catalog session's title keys from its central state (or session.db before it is imported), without importing. */
	readonly readSessionValues?: (session: URI, keys: readonly string[]) => Promise<ReadonlyMap<string, string>>;
	readonly queueCatalogSync?: (session: ProtocolURI, metadataOverrides: Readonly<Record<string, string>>) => void;
	readonly persistSurfacedSessionTitle?: (session: ProtocolURI, title: string) => Promise<void>;
	readonly getGitHubToken?: (session: ProtocolURI, chat?: ProtocolURI, source?: IAgentHostCredentialSource) => string | undefined;
	readonly getGitHubHost?: () => string | undefined;
	readonly gitHubContextRequestTimeout?: number;
	readonly gitHubService?: IAgentHostGitHubService;
	readonly utilityModelService?: IAgentHostUtilityModelService;
	readonly getInitialTitleGenerationStrategy?: () => AutomaticTitleGenerationStrategy;
}

export const IAgentHostSessionTitleController = createDecorator<IAgentHostSessionTitleController>('agentHostSessionTitleController');

/** Coordinates automatic, generated, and user-renamed session and chat titles. */
export interface IAgentHostSessionTitleController {
	readonly _serviceBrand: undefined;
	getAutomaticTitleGenerationStrategy(channel?: ProtocolURI): AutomaticTitleGenerationStrategy;
	restoreTitleGenerationStrategy(channel: ProtocolURI, chatChannel?: ProtocolURI): Promise<void>;
	seedTitleFromFirstMessage(channel: ProtocolURI, userPrompt: string, chatChannel?: ProtocolURI, model?: ModelSelection): void;
	seedProvisionalTitle(channel: ProtocolURI, suggestedTitle: string, chatChannel?: ProtocolURI): void;
	refineTitleFromFirstTurn(channel: ProtocolURI, chatChannel?: ProtocolURI, successful?: boolean): void;
	generateForkedTitle(channel: ProtocolURI, chatChannel: ProtocolURI | undefined, turns: readonly Turn[], fallbackTitle: string, sourceTitle?: string, initialPrompt?: string): void;
	generateExternalSessionTitle(session: ProtocolURI, userPrompt: string): Promise<void>;
	cancelTitleGeneration(session: ProtocolURI): void;
	/** Drops title state of a session and of `chatChannels`, which must list every chat of the session, its default chat included. */
	clearSession(session: ProtocolURI, chatChannels: readonly ProtocolURI[]): void;
	markTitleAuto(channel: ProtocolURI, chatChannel: ProtocolURI | undefined, title: string): void;
	markTitleRenamed(channel: ProtocolURI, chatChannel?: ProtocolURI, title?: string): void;
	/** Whether the title of the session or of its chat `chatChannel` was renamed, even if that isn't persisted yet. */
	isTitleRenamed(channel: ProtocolURI, chatChannel?: ProtocolURI): boolean;
	prepareInstructionForAgent(channel: ProtocolURI, chatChannel: ProtocolURI): Promise<string | undefined>;
}

export class AgentHostSessionTitleController extends Disposable implements IAgentHostSessionTitleController {

	declare readonly _serviceBrand: undefined;

	private readonly _titleGenerationCancellationSources = new Map<ProtocolURI, CancellationTokenSource>();
	private readonly _forkTitleContexts = new Map<ProtocolURI, { readonly sourceTitle?: string; readonly initialPrompt: string }>();

	/**
	 * The most recent title this controller applied for a given session/chat
	 * key. Used to detect whether the title was changed (e.g. a manual
	 * `/rename` or user edit) since we last set it, so we never clobber a
	 * deliberate title with an auto-generated one.
	 */
	private readonly _lastAppliedTitle = new Map<ProtocolURI, string>();

	/**
	 * Session/chat keys whose current title is a provisional placeholder set by
	 * {@link seedProvisionalTitle} (e.g. from a `!command`). Such a title does
	 * not describe the session's topic, so the first subsequent request that
	 * carries real intent replaces it with a generated title via
	 * {@link seedTitleFromFirstMessage}.
	 */
	private readonly _provisionalTitles = new Set<ProtocolURI>();
	private readonly _autoTitles = new Set<ProtocolURI>();
	private readonly _renamedTitles = new Set<ProtocolURI>();
	private readonly _titleGenerationStrategies = new Map<ProtocolURI, AutomaticTitleGenerationStrategy>();
	private readonly _unpersistedTitleStrategies = new Set<ProtocolURI>();
	private readonly _restoringTitleStrategies = new Map<ProtocolURI, Promise<void>>();
	private readonly _restoringDeferredSeeds = new Map<ProtocolURI, object>();
	private readonly _deferredRefinementStarted = new Set<ProtocolURI>();
	private readonly _deferredFirstTurnIndices = new Map<ProtocolURI, number>();
	private readonly _titleReviewReminderCounts = new Map<ProtocolURI, number>();

	constructor(
		private readonly _stateManager: AgentHostStateManager,
		private readonly _options: IAgentHostSessionTitleControllerOptions,
		@ILogService private readonly _logService: ILogService,
		@IAgentHostChatOwnershipService private readonly _chatOwnership: IAgentHostChatOwnershipService,
	) {
		super();
	}

	seedTitleFromFirstMessage(channel: ProtocolURI, userPrompt: string, chatChannel?: ProtocolURI, model?: ModelSelection): void {
	}

	/** Seeds and persists a provisional title suggested by a locally handled command. */
	seedProvisionalTitle(channel: ProtocolURI, suggestedTitle: string, chatChannel?: ProtocolURI): void {
		if (this._isEphemeralSession(channel)) {
			return;
		}
		const title = this._normalizeTitle(suggestedTitle, this.getAutomaticTitleGenerationStrategy(channel) !== 'utility' ? MAX_ACTIVE_AGENT_FALLBACK_TITLE_LENGTH : MAX_TITLE_LENGTH);
		if (!title) {
			return;
		}

		const independentChat = this._independentChatChannel(channel, chatChannel);
		const key = independentChat ?? channel;
		const state = independentChat ? this._stateManager.getChatState(independentChat) : this._stateManager.getSessionState(channel);
		if (!state || !this._canSeedProvisionalTitle(key, state.title)) {
			return;
		}
		this._provisionalTitles.add(key);
		this._applySeedTitle(channel, independentChat, title);
		this._persistAutoTitle(channel, independentChat, title);
	}

	/** Trims, collapses whitespace, and length-caps a candidate title. */
	private _normalizeTitle(text: string, maxLength = MAX_TITLE_LENGTH): string {
		return Array.from(text.trim().replace(/\s+/g, ' ')).slice(0, maxLength).join('').trim();
	}

	/**
	 * The independently titled chat a seed should target, or `undefined` to
	 * title the session-backed sole default chat.
	 */
	private _independentChatChannel(channel: ProtocolURI, chatChannel?: ProtocolURI): ProtocolURI | undefined {
		if (!chatChannel || !isAhpChatChannel(chatChannel)) {
			return undefined;
		}
		return !this._chatOwnership.isDefaultChat(channel, chatChannel) || (this._stateManager.getSessionState(channel)?.chats.length ?? 1) > 1
			? chatChannel
			: undefined;
	}

	/**
	 * Applies `title` to the independently titled chat (`independentChat`) or, when
	 * that is `undefined`, to the session itself, recording it as last-applied.
	 */
	private _applySeedTitle(channel: ProtocolURI, independentChat: ProtocolURI | undefined, title: string): void {
		if (independentChat) {
			this._applyTitle(independentChat, title, t => this._stateManager.updateChatTitle(channel, independentChat, t));
			this._persistAutoTitleSource(channel, independentChat);
		} else {
			this._applyTitle(channel, title, t => this._stateManager.dispatchServerAction(channel, {
				type: ActionType.SessionTitleChanged,
				title: t,
			}));
			this._persistAutoTitleSource(channel, undefined);
		}
	}

	/** Persists `title` as the custom title of the addressed independent chat or session. */
	private _persistAutoTitle(channel: ProtocolURI, independentChat: ProtocolURI | undefined, title: string): void {
		if (independentChat) {
			this._persistSessionFlag(independentChat, SESSION_CUSTOM_TITLE_KEY, title);
			this._persistSessionFlag(independentChat, SESSION_CUSTOM_TITLE_SOURCE_KEY, AGENT_HOST_TITLE_SOURCE_AUTO);
			this._persistSessionFlag(channel, customChatTitleMetadataKey(independentChat), title);
			this._persistSessionFlag(channel, customChatTitleSourceMetadataKey(independentChat), AGENT_HOST_TITLE_SOURCE_AUTO);
			this._options.queueCatalogSync?.(channel, {
				[customChatTitleMetadataKey(independentChat)]: title,
				[customChatTitleSourceMetadataKey(independentChat)]: AGENT_HOST_TITLE_SOURCE_AUTO,
			});
			return;
		}
		const defaultChat = this._stateManager.getSessionState(channel)?.defaultChat;
		if (defaultChat) {
			this._persistSessionFlag(defaultChat, SESSION_CUSTOM_TITLE_KEY, title);
			this._persistSessionFlag(defaultChat, SESSION_CUSTOM_TITLE_SOURCE_KEY, AGENT_HOST_TITLE_SOURCE_AUTO);
		}
		this._persistSessionFlag(channel, SESSION_CUSTOM_TITLE_KEY, title);
		this._persistSessionFlag(channel, SESSION_CUSTOM_TITLE_SOURCE_KEY, AGENT_HOST_TITLE_SOURCE_AUTO);
	}

	private _persistAutoTitleSource(channel: ProtocolURI, independentChat: ProtocolURI | undefined): void {
		if (independentChat) {
			this._persistSessionFlag(independentChat, SESSION_CUSTOM_TITLE_SOURCE_KEY, AGENT_HOST_TITLE_SOURCE_AUTO);
			this._persistSessionFlag(channel, customChatTitleSourceMetadataKey(independentChat), AGENT_HOST_TITLE_SOURCE_AUTO);
			return;
		}
		const defaultChat = this._stateManager.getSessionState(channel)?.defaultChat;
		if (defaultChat) {
			this._persistSessionFlag(defaultChat, SESSION_CUSTOM_TITLE_SOURCE_KEY, AGENT_HOST_TITLE_SOURCE_AUTO);
		}
		this._persistSessionFlag(channel, SESSION_CUSTOM_TITLE_SOURCE_KEY, AGENT_HOST_TITLE_SOURCE_AUTO);
	}

	/** The live title of the addressed independent chat or session. */
	private _currentSeedTitle(channel: ProtocolURI, independentChat: ProtocolURI | undefined): string | undefined {
		return independentChat ? this._stateManager.getChatState(independentChat)?.title : this._stateManager.getSessionState(channel)?.title;
	}

	/**
	 * Whether {@link seedProvisionalTitle} may (re)title `key`: true when it is
	 * untitled (the first message carried a suggestion) or when its title is a
	 * provisional placeholder we applied and no one has changed it since —
	 * successive suggestions keep the newest one visible without clobbering a
	 * manual rename.
	 */
	private _canSeedProvisionalTitle(key: ProtocolURI, currentTitle: string | undefined): boolean {
		if (!currentTitle) {
			return true;
		}
		return this._provisionalTitles.has(key) && currentTitle === this._lastAppliedTitle.get(key);
	}

	/** Refines the seed from the first response without awaiting utility work or overwriting an explicit rename. */
	refineTitleFromFirstTurn(channel: ProtocolURI, chatChannel?: ProtocolURI, successful = true): void {
	}

	/** Titles a fork from bounded inherited context in utility mode; deferred mode waits for its first new response. */
	generateForkedTitle(channel: ProtocolURI, chatChannel: ProtocolURI | undefined, turns: readonly Turn[], fallbackTitle: string, sourceTitle?: string, initialPrompt?: string): void {
		if (this._isEphemeralSession(channel)) {
			return;
		}
		const strategy = this.getAutomaticTitleGenerationStrategy(channel);
		if (initialPrompt !== undefined && !this._canGeneratePromptForkedTitle(channel, chatChannel, fallbackTitle)) {
			return;
		}
		if (strategy !== 'utility') {
			this.markTitleAuto(channel, chatChannel, fallbackTitle);
			const independentChat = this._independentChatChannel(channel, chatChannel);
			const key = independentChat ?? channel;
			if (initialPrompt !== undefined) {
				this._forkTitleContexts.set(key, {
					...(sourceTitle ? { sourceTitle: this._truncateForkTitleContext(sourceTitle) } : {}),
					initialPrompt: this._truncateForkTitleContext(initialPrompt),
				});
			}
			if (isDeferredTitleGenerationStrategy(strategy)) {
				this._deferredFirstTurnIndices.set(key, turns.length);
				this._persistDeferredTitleSeed(channel, independentChat, {
					title: fallbackTitle,
					turnIndex: turns.length,
					...(sourceTitle ? { sourceTitle: this._truncateForkTitleContext(sourceTitle) } : {}),
					...(initialPrompt !== undefined ? { initialPrompt: this._truncateForkTitleContext(initialPrompt) } : {}),
				});
			}
			return;
		}
		const context = this._buildConversationContext(turns, sourceTitle, initialPrompt);
		if (!context) {
			return;
		}

		const isAdditionalChat = !!chatChannel && isAhpChatChannel(chatChannel) && !this._chatOwnership.isDefaultChat(channel, chatChannel);
		if (isAdditionalChat) {
			const key = chatChannel;
			this._lastAppliedTitle.set(key, fallbackTitle);
			this._persistAutoTitleSource(channel, key);
			return;
		}

		this._lastAppliedTitle.set(channel, fallbackTitle);
		this._persistAutoTitleSource(channel, undefined);
	}

	private _applyTitle(key: ProtocolURI, title: string, dispatch: (title: string) => void): void {
		this._lastAppliedTitle.set(key, title);
		dispatch(title);
	}

	/** A prompt fork must not turn a rename made during chat creation back into an automatic title. */
	private _canGeneratePromptForkedTitle(channel: ProtocolURI, chatChannel: ProtocolURI | undefined, fallbackTitle: string): boolean {
		const independentChat = this._independentChatChannel(channel, chatChannel);
		const key = independentChat ?? channel;
		return !this._renamedTitles.has(key) && this._currentSeedTitle(channel, independentChat) === fallbackTitle;
	}

	/**
	 * Generates a title for an external session whose provider surfaced it
	 * without one, from the user's first prompt. Such a session usually has no
	 * live state (it is materialized when opened), so the generated title is
	 * persisted and pushed onto its surfaced summary. A session that already
	 * carries a persisted title keeps it; a rename during generation cancels it.
	 *
	 * Unlike the other entry points this awaits generation, so the caller's
	 * deferred-work lane stays serialized against it.
	 */
	async generateExternalSessionTitle(session: ProtocolURI, _userPrompt: string): Promise<void> {
		if (this._isEphemeralSession(session) || await this._readPersistedTitleMetadata(session, SESSION_CUSTOM_TITLE_KEY)) {
			return;
		}
	}

	cancelTitleGeneration(session: ProtocolURI): void {
		this._cancelTitleGeneration(session);
	}

	clearSession(session: ProtocolURI, chatChannels: readonly ProtocolURI[]): void {
		for (const key of [session, ...chatChannels]) {
			this._cancelTitleGeneration(key);
			this._lastAppliedTitle.delete(key);
			this._provisionalTitles.delete(key);
			this._autoTitles.delete(key);
			this._renamedTitles.delete(key);
			this._deferredRefinementStarted.delete(key);
			this._deferredFirstTurnIndices.delete(key);
			this._titleReviewReminderCounts.delete(key);
			this._restoringDeferredSeeds.delete(key);
			this._forkTitleContexts.delete(key);
		}
		this._titleGenerationStrategies.delete(session);
		this._unpersistedTitleStrategies.delete(session);
		this._restoringTitleStrategies.delete(session);
	}

	markTitleAuto(channel: ProtocolURI, chatChannel: ProtocolURI | undefined, title: string): void {
		const independentChat = this._independentChatChannel(channel, chatChannel);
		const key = independentChat ?? channel;
		this._lastAppliedTitle.set(key, title);
		this._autoTitles.add(key);
		this._renamedTitles.delete(key);
		this._persistAutoTitle(channel, independentChat, title);
	}

	markTitleRenamed(channel: ProtocolURI, chatChannel?: ProtocolURI, title?: string): void {
		const independentChat = this._independentChatChannel(channel, chatChannel);
		const key = independentChat ?? channel;
		this._cancelTitleGeneration(key);
		this._autoTitles.delete(key);
		this._provisionalTitles.delete(key);
		this._renamedTitles.add(key);
		this._forkTitleContexts.delete(key);
		if (isDeferredTitleGenerationStrategy(this._titleGenerationStrategies.get(channel))) {
			this._clearDeferredTitleSeed(channel, independentChat);
		}
		if (independentChat && title !== undefined) {
			this._options.queueCatalogSync?.(channel, {
				[customChatTitleMetadataKey(independentChat)]: title,
				[customChatTitleSourceMetadataKey(independentChat)]: AGENT_HOST_TITLE_SOURCE_USER,
			});
		}
	}

	isTitleRenamed(channel: ProtocolURI, chatChannel?: ProtocolURI): boolean {
		return this._renamedTitles.has(this._independentChatChannel(channel, chatChannel) ?? channel);
	}

	async prepareInstructionForAgent(channel: ProtocolURI, chatChannel: ProtocolURI): Promise<string | undefined> {
		if (this._isEphemeralSession(channel)) {
			return undefined;
		}
		const strategy = this.getAutomaticTitleGenerationStrategy(channel);
		if (strategy !== 'activeAgent' && strategy !== 'agentReview') {
			return undefined;
		}
		const independentChat = this._independentChatChannel(channel, chatChannel);
		const key = independentChat ?? channel;
		if (this._renamedTitles.has(key)) {
			return undefined;
		}
		this._syncDefaultChatTitleReviewReminderCount(channel, key);
		// Review mode leaves a fresh seed to the host's first-response refinement before inviting a rename.
		if (strategy === 'agentReview' && !this._canOfferTitleReview(channel, independentChat, key)) {
			return undefined;
		}
		const sourceKey = independentChat ? customChatTitleSourceMetadataKey(independentChat) : SESSION_CUSTOM_TITLE_SOURCE_KEY;
		const source = await this._readPersistedTitleMetadata(channel, sourceKey);
		if (source === AGENT_HOST_TITLE_SOURCE_USER || source === AGENT_HOST_TITLE_SOURCE_AGENT) {
			this.markTitleRenamed(channel, independentChat);
			return undefined;
		}
		if (source !== AGENT_HOST_TITLE_SOURCE_AUTO && !this._autoTitles.has(key)) {
			return undefined;
		}

		if (strategy === 'agentReview') {
			const currentTitle = this._currentSeedTitle(channel, independentChat);
			if (!currentTitle) {
				return undefined;
			}
			this._titleReviewReminderCounts.set(key, (this._titleReviewReminderCounts.get(key) ?? 0) + 1);
			return chatTitleReviewReminder(currentTitle);
		}
		const forkContext = this._forkTitleContexts.get(key);
		this._forkTitleContexts.delete(key);
		return forkContext
			? `${CHAT_RENAME_REMINDER}\n\nThis fork continues "${forkContext.sourceTitle ?? 'an earlier chat'}". The user's new request is:\n${forkContext.initialPrompt}`
			: CHAT_RENAME_REMINDER;
	}

	/**
	 * Whether review mode may invite a rename for `key`: only after the first
	 * response since the seed has finished (successfully or not), never while a
	 * host refinement is still in flight, and for at most
	 * {@link MAX_TITLE_REVIEW_REMINDERS} turns.
	 */
	private _canOfferTitleReview(channel: ProtocolURI, independentChat: ProtocolURI | undefined, key: ProtocolURI): boolean {
		if ((this._titleReviewReminderCounts.get(key) ?? 0) >= MAX_TITLE_REVIEW_REMINDERS || this._titleGenerationCancellationSources.has(key)) {
			return false;
		}
		// A refinement started before a peer made the default chat independent is still keyed by the session.
		if (independentChat && this._chatOwnership.isDefaultChat(channel, independentChat) && this._titleGenerationCancellationSources.has(channel)) {
			return false;
		}
		const state = independentChat ? this._stateManager.getChatState(independentChat) : this._stateManager.getSessionState(channel);
		// Any finished response settles first-response refinement: a cancelled or failed one consumes it without refining.
		const seedTurnIndex = this._deferredFirstTurnIndices.get(key) ?? 0;
		return !!state && state.turns.length > seedTurnIndex;
	}

	/**
	 * The default chat is titled under the session key while it is the only chat
	 * and under its own URI once a peer exists. Adding or removing peers moves
	 * between the two keys, so carry the higher count onto the active `key` to
	 * keep the per-chat cap across the transition.
	 */
	private _syncDefaultChatTitleReviewReminderCount(channel: ProtocolURI, key: ProtocolURI): void {
		if (key !== channel && !this._chatOwnership.isDefaultChat(channel, key)) {
			return;
		}
		const defaultChat = key === channel ? this._chatOwnership.getDefaultChat(channel) : key;
		const count = Math.max(this._titleReviewReminderCounts.get(channel) ?? 0, defaultChat === undefined ? 0 : this._titleReviewReminderCounts.get(defaultChat) ?? 0);
		if (count > 0) {
			this._titleReviewReminderCounts.set(key, count);
		}
	}

	/**
	 * Builds a conversation context string for forked-title generation by
	 * concatenating each kept turn's user request and textual response. Only
	 * normal text (markdown) response parts are considered — tool calls,
	 * reasoning, and other parts are ignored, mirroring
	 * {@link _buildFirstTurnContext}. When the fork's `sourceTitle` is known, a
	 * short framing note is prepended so the model understands the conversation
	 * is a branch continued from an earlier chat. The conversation is
	 * middle-truncated to {@link MAX_TITLE_CONTEXT_CHARS} to bound model cost;
	 * the framing note is always preserved in full.
	 *
	 * @returns the context string, or `undefined` when no turn carries any
	 * text worth titling from.
	 */
	private _buildConversationContext(turns: readonly Turn[], sourceTitle?: string, initialPrompt?: string): string | undefined {
		// Preserve the established bare-fork utility input exactly.
		if (initialPrompt === undefined) {
			const framedTitle = sourceTitle?.trim();
			const framing = framedTitle
				? `This conversation was branched from an earlier chat titled "${framedTitle}". The turns below, oldest first, are the inherited history up to the branch point.\n\n`
				: undefined;
			return buildConversationContext(turns, { maxChars: MAX_TITLE_CONTEXT_CHARS, framing });
		}
		const prefix = this._buildPromptForkContextPrefix(sourceTitle, initialPrompt);
		const history = buildConversationContext(turns, { maxChars: Math.max(0, MAX_TITLE_CONTEXT_CHARS - prefix.length) });
		return history ? `${prefix}${history}` : prefix.trimEnd();
	}

	/** Builds a bounded prompt-fork prefix without allowing inherited title context to crowd out the new request. */
	private _buildPromptForkContextPrefix(sourceTitle: string | undefined, initialPrompt: string): string {
		const sourcePrefix = 'This conversation was branched from an earlier chat titled "';
		const sourceSuffix = '". The turns below, oldest first, are the inherited history up to the branch point.\n\n';
		const promptPrefix = 'The new user request for this fork is:\n';
		const promptSuffix = '\n\n';
		const hasSource = !!sourceTitle?.trim();
		const fixedLength = promptPrefix.length + promptSuffix.length + (hasSource ? sourcePrefix.length + sourceSuffix.length : 0);
		const contentBudget = Math.max(0, MAX_TITLE_CONTEXT_CHARS - fixedLength);
		const sourceBudget = hasSource ? Math.floor(contentBudget / 2) : 0;
		const promptBudget = contentBudget - sourceBudget;
		const source = hasSource ? truncateMiddle(sourceTitle!.trim(), sourceBudget) : '';
		const prompt = truncateMiddle(initialPrompt, promptBudget);
		return `${hasSource ? `${sourcePrefix}${source}${sourceSuffix}` : ''}${promptPrefix}${prompt}${promptSuffix}`;
	}

	private _truncateForkTitleContext(value: string): string {
		return value.length > Math.floor(MAX_TITLE_CONTEXT_CHARS / 2)
			? truncateMiddle(value, Math.floor(MAX_TITLE_CONTEXT_CHARS / 2))
			: value;
	}

	private _persistSessionFlag(session: ProtocolURI, key: string, value: string): void {
		if (this._options.persistMetadata && (key === SESSION_CUSTOM_TITLE_KEY || key === SESSION_CUSTOM_TITLE_SOURCE_KEY || key.startsWith('customChatTitle:') || key.startsWith('customChatTitleSource:'))) {
			void this._options.persistMetadata(session, { [key]: value }).catch(error => this._logService.warn(`[AgentHostSessionTitleController] Failed to persist ${key}`, error));
			return;
		}
		// Strategy and deferred-seed keys are not central state; production routes titles through `persistMetadata`.
		try {
			const reference = this._options.sessionDataService.openDatabase(URI.parse(session));
			reference.object.setMetadata(key, value)
				.catch(err => this._logService.warn(`[AgentHost] Failed to persist session metadata '${key}'`, err))
				.finally(() => reference.dispose());
		} catch (err) {
			this._logService.warn(`[AgentHost] Failed to persist session metadata '${key}'`, err);
		}
	}

	/** Snapshots host-owned scheduling independently of explicit rename-tool availability. */
	getAutomaticTitleGenerationStrategy(channel?: ProtocolURI): AutomaticTitleGenerationStrategy {
		const existing = channel && this._titleGenerationStrategies.get(channel);
		if (existing) {
			if (this._unpersistedTitleStrategies.has(channel) && this._stateManager.getSessionState(channel)) {
				this._unpersistedTitleStrategies.delete(channel);
				if (!this._isEphemeralSession(channel)) {
					this._persistSessionFlag(channel, TITLE_GENERATION_STRATEGY_KEY, existing);
				}
			}
			return existing;
		}
		const state = channel ? this._stateManager.getSessionState(channel) : undefined;
		// Tool membership is only a compatibility fallback for sessions materialized before strategy snapshots.
		const strategy = state?.serverTools
			? state.serverTools.some(tool => tool.name === SessionServerToolName.RenameChat) ? 'activeAgent' : 'utility'
			: this._options.getInitialTitleGenerationStrategy?.() ?? 'utility';
		if (channel && !this._isEphemeralSession(channel)) {
			this._titleGenerationStrategies.set(channel, strategy);
			if (state) {
				this._persistSessionFlag(channel, TITLE_GENERATION_STRATEGY_KEY, strategy);
			} else {
				this._unpersistedTitleStrategies.add(channel);
			}
		}
		return strategy;
	}

	/** Restores scheduling without opting legacy sessions into the deferred experiment. */
	async restoreTitleGenerationStrategy(channel: ProtocolURI, chatChannel?: ProtocolURI): Promise<void> {
		await this._restoreTitleGenerationStrategy(channel);
		if (chatChannel && isDeferredTitleGenerationStrategy(this._titleGenerationStrategies.get(channel))) {
			await this._restoreDeferredTitleSeed(channel, chatChannel);
		}
	}

	private async _restoreTitleGenerationStrategy(channel: ProtocolURI): Promise<void> {
		if (this._titleGenerationStrategies.has(channel)) {
			return;
		}
		const existing = this._restoringTitleStrategies.get(channel);
		if (existing) {
			return existing;
		}
		const restore = async () => {
			const persisted = await this._readPersistedTitleMetadata(channel, TITLE_GENERATION_STRATEGY_KEY);
			if (this._store.isDisposed || this._restoringTitleStrategies.get(channel) !== pending || this._titleGenerationStrategies.has(channel)) {
				return;
			}
			const strategy = isAutomaticTitleGenerationStrategy(persisted) ? persisted : 'utility';
			this._titleGenerationStrategies.set(channel, strategy);
			this._persistSessionFlag(channel, TITLE_GENERATION_STRATEGY_KEY, strategy);
		};
		const pending = restore();
		this._restoringTitleStrategies.set(channel, pending);
		try {
			await pending;
		} finally {
			if (this._restoringTitleStrategies.get(channel) === pending) {
				this._restoringTitleStrategies.delete(channel);
			}
		}
	}

	private _deferredTitleSeedMetadataKey(independentChat: ProtocolURI | undefined): string {
		return independentChat ? `${DEFERRED_TITLE_SEED_KEY}:${independentChat}` : DEFERRED_TITLE_SEED_KEY;
	}

	private _persistDeferredTitleSeed(channel: ProtocolURI, independentChat: ProtocolURI | undefined, seed: IDeferredTitleSeed): void {
		this._persistSessionFlag(channel, this._deferredTitleSeedMetadataKey(independentChat), JSON.stringify(seed));
	}

	private _clearDeferredTitleSeed(channel: ProtocolURI, independentChat: ProtocolURI | undefined): void {
		this._persistSessionFlag(channel, this._deferredTitleSeedMetadataKey(independentChat), '');
		if (independentChat && this._chatOwnership.isDefaultChat(channel, independentChat)) {
			this._persistSessionFlag(channel, DEFERRED_TITLE_SEED_KEY, '');
		}
	}

	private async _restoreDeferredTitleSeed(channel: ProtocolURI, chatChannel: ProtocolURI): Promise<void> {
		const restore = {};
		this._restoringDeferredSeeds.set(chatChannel, restore);
		try {
			const ref = await this._options.sessionDataService.tryOpenDatabase(URI.parse(channel));
			if (!ref) {
				return;
			}
			try {
				let independentChat: ProtocolURI | undefined = chatChannel;
				let raw = await ref.object.getMetadata(this._deferredTitleSeedMetadataKey(independentChat));
				if (raw === undefined && this._chatOwnership.isDefaultChat(channel, chatChannel)) {
					independentChat = undefined;
					raw = await ref.object.getMetadata(DEFERRED_TITLE_SEED_KEY);
				}
				if (!raw) {
					return;
				}
				const parsedSeed: unknown = JSON.parse(raw);
				if (!isObject(parsedSeed)) {
					return;
				}
				const seed = parsedSeed as Record<string, unknown>;
				if (typeof seed.title !== 'string' || typeof seed.turnIndex !== 'number' || !Number.isSafeInteger(seed.turnIndex) || seed.turnIndex < 0) {
					return;
				}
				const sourceTitle = seed.sourceTitle;
				const initialPrompt = seed.initialPrompt;
				if ((sourceTitle !== undefined && typeof sourceTitle !== 'string')
					|| (initialPrompt !== undefined && typeof initialPrompt !== 'string')) {
					throw new Error('Invalid deferred title seed fork context');
				}
				const normalized = await this._options.readNormalizedChat?.(URI.parse(channel), URI.parse(chatChannel));
				if (normalized?.normalized && !normalized.chat) {
					throw new Error(`Missing normalized chat during deferred title restoration: ${chatChannel}`);
				}
				const titleKey = independentChat ? customChatTitleMetadataKey(independentChat) : SESSION_CUSTOM_TITLE_KEY;
				const sourceKey = independentChat ? customChatTitleSourceMetadataKey(independentChat) : SESSION_CUSTOM_TITLE_SOURCE_KEY;
				const values = normalized?.normalized ? undefined : await this._options.readSessionValues?.(URI.parse(channel), [titleKey, sourceKey]);
				const [title, source] = normalized?.normalized
					? [normalized.chat?.metadata?.summary, normalized.chat?.metadata?.titleSource]
					: [values?.get(titleKey), values?.get(sourceKey)];
				const key = independentChat ?? channel;
				if (this._store.isDisposed || this._restoringDeferredSeeds.get(chatChannel) !== restore || !isDeferredTitleGenerationStrategy(this._titleGenerationStrategies.get(channel)) || this._lastAppliedTitle.has(key) || this._renamedTitles.has(key) || this._deferredRefinementStarted.has(key)) {
					return;
				}
				if (source === AGENT_HOST_TITLE_SOURCE_AUTO && title === seed.title) {
					this._lastAppliedTitle.set(key, seed.title);
					this._deferredFirstTurnIndices.set(key, seed.turnIndex);
					if (initialPrompt !== undefined) {
						this._forkTitleContexts.set(key, { ...(sourceTitle !== undefined ? { sourceTitle } : {}), initialPrompt });
					}
				}
			} finally {
				ref.dispose();
			}
		} catch (err) {
			this._logService.warn('[AgentHostSessionTitleController] Failed to restore deferred title seed', err);
		} finally {
			if (this._restoringDeferredSeeds.get(chatChannel) === restore) {
				this._restoringDeferredSeeds.delete(chatChannel);
			}
		}
	}

	private _isEphemeralSession(channel: ProtocolURI): boolean {
		return this._stateManager.isEphemeralSession(channel);
	}

	private async _readPersistedTitleMetadata(session: ProtocolURI, key: string): Promise<string | undefined> {
		try {
			const ref = await this._options.sessionDataService.tryOpenDatabase?.(URI.parse(session));
			if (!ref) {
				return undefined;
			}
			try {
				return await ref.object.getMetadata(key);
			} finally {
				ref.dispose();
			}
		} catch (err) {
			this._logService.warn(`[AgentHostSessionTitleController] Failed to read title metadata '${key}'`, err);
			return undefined;
		}
	}

	private _cancelTitleGeneration(session: ProtocolURI): void {
		const source = this._titleGenerationCancellationSources.get(session);
		if (!source) {
			return;
		}
		source.dispose(true);
		this._titleGenerationCancellationSources.delete(session);
	}

	override dispose(): void {
		for (const source of this._titleGenerationCancellationSources.values()) {
			source.dispose(true);
		}
		this._titleGenerationCancellationSources.clear();
		this._lastAppliedTitle.clear();
		this._provisionalTitles.clear();
		this._autoTitles.clear();
		this._renamedTitles.clear();
		this._titleGenerationStrategies.clear();
		this._unpersistedTitleStrategies.clear();
		this._restoringTitleStrategies.clear();
		this._restoringDeferredSeeds.clear();
		this._deferredRefinementStarted.clear();
		this._deferredFirstTurnIndices.clear();
		this._titleReviewReminderCounts.clear();
		this._forkTitleContexts.clear();
		super.dispose();
	}
}
