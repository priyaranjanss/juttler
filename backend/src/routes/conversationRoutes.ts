import { Router, Request, Response } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { User, Bot, Message } from '../../../frontend/src/types/index';
import { findUserById } from '../repositories/users';
import { listBotsForUser, findBotById } from '../repositories/bots';
import {
  listAllConversations,
  listConversationsForUser,
  findConversationById,
  createConversation,
  listMessages,
  createMessage,
  touchConversation,
} from '../repositories/conversations';
import { runBotTurn, BotToolSpec } from '../services/aiService';
import { runBotTurnWithTools, DELEGATE_TOOL, describeWorkspaceTool } from '../services/botTurn';
import { isWorkspaceTool } from '../services/workspaceTools';
import { callTool, executeApprovedTool, resolveApproval } from '../services/pluginGateway';
import { listBotAvailableTools, findInstallationByUserAndPlugin } from '../repositories/plugins';
import { generateId } from '../utils/id';

// How much of the thread is replayed as context for the model.
const HISTORY_LIMIT = 20;

const router = Router();

router.get('/conversations', asyncHandler(async (req: Request, res: Response) => {
  const userId = req.query.userId as string;
  const isAdmin = req.query.isAdmin === 'true';

  if (isAdmin) {
    return res.json(await listAllConversations());
  }
  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }
  res.json(await listConversationsForUser(userId));
}));

router.post('/conversations', asyncHandler(async (req: Request, res: Response) => {
  const { userId, title, isGroup, participantBotIds } = req.body;
  if (!userId || !title) {
    return res.status(400).json({ error: 'userId and title required' });
  }
  res.json(await createConversation({ userId, title, isGroup: !!isGroup, participantBotIds: participantBotIds || [] }));
}));

router.get('/conversations/:id/messages', asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  res.json(await listMessages(id));
}));

router.post('/chat', asyncHandler(async (req: Request, res: Response) => {
  const { conversationId, userId, messageContent, targetBotId } = req.body;

  if (!conversationId || !userId || !messageContent) {
    return res.status(400).json({ error: 'Missing required parameters' });
  }

  const conv = await findConversationById(conversationId);
  if (!conv) {
    return res.status(404).json({ error: 'Conversation not found' });
  }

  const user: User | null = await findUserById(userId);

  const userMsg: Message = {
    id: generateId('msg_'),
    conversationId,
    senderType: 'user',
    senderId: userId,
    senderName: user?.name || 'User',
    content: messageContent,
    type: 'text',
    timestamp: new Date().toISOString(),
  };
  await createMessage(userMsg);
  await touchConversation(conversationId, messageContent);

  // Everything before this turn, for context.
  const history = (await listMessages(conversationId)).slice(-HISTORY_LIMIT);

  let activeBot: Bot | null = null;
  if (targetBotId) {
    activeBot = await findBotById(targetBotId);
  } else if (conv.participantBotIds.length > 0) {
    for (const bId of conv.participantBotIds) {
      const b = await findBotById(bId);
      if (b && messageContent.toLowerCase().includes(`@${b.name.toLowerCase()}`)) {
        activeBot = b;
        break;
      }
    }
    if (!activeBot) {
      activeBot = await findBotById(conv.participantBotIds[0]);
    }
  }

  if (!activeBot) {
    const userBots = await listBotsForUser(userId);
    activeBot = userBots.find((b) => b.isChiefOfStaff) || null;
  }

  const returnedMessages: Message[] = [userMsg];

  if (!activeBot) {
    const fallbackMsg: Message = {
      id: generateId('msg_'),
      conversationId,
      senderType: 'system',
      senderId: 'sys',
      senderName: 'System',
      content: 'No bot is assigned to this conversation. Please assign a bot to continue.',
      type: 'system',
      timestamp: new Date().toISOString(),
    };
    await createMessage(fallbackMsg);
    returnedMessages.push(fallbackMsg);
    return res.json({ messages: returnedMessages, activeBot: null });
  }

  // Run the turn: plugins, approval gates, and (for the Chief) delegation to
  // specialist bots as sub-agents.
  const turn = await runBotTurnWithTools({
    userId,
    bot: activeBot,
    userName: user?.name || 'User',
    messageContent,
    history,
    conversationId,
  });

  // Persist the real tool activity so the thread shows what actually happened
  for (const event of turn.tools) {
    const toolCallMsg: Message = {
      id: generateId('msg_'),
      conversationId,
      senderType: 'bot',
      senderId: activeBot.id,
      senderName: activeBot.name,
      senderAvatar: activeBot.avatar,
      senderColor: activeBot.color,
    content:
      event.toolName === DELEGATE_TOOL
        ? `Delegating to ${String(event.args?.bot_name || 'a specialist')}...`
        : isWorkspaceTool(event.toolName)
          ? describeWorkspaceTool(event.toolName, event.args)
          : `Calling ${event.toolName}...`,
    type: 'tool_call',
      metadata: {
        toolCall: {
          callId: event.callId,
          toolName: event.toolName,
          args: event.args,
          durationMs: event.durationMs,
        },
      },
      timestamp: new Date().toISOString(),
    };
    await createMessage(toolCallMsg);
    returnedMessages.push(toolCallMsg);

    if (event.status === 'needs_approval' && event.approvalId) {
      const approvalMsg: Message = {
        id: generateId('msg_'),
        conversationId,
        senderType: 'bot',
        senderId: activeBot.id,
        senderName: activeBot.name,
        senderAvatar: activeBot.avatar,
        senderColor: activeBot.color,
        content: event.reason || 'This action needs your approval.',
        type: 'approval_request',
        metadata: {
          approvalId: event.approvalId,
          actionName: event.actionName,
          toolParams: event.args,
        },
        timestamp: new Date().toISOString(),
      };
      await createMessage(approvalMsg);
      returnedMessages.push(approvalMsg);
      continue;
    }

    const resultMsg: Message = {
      id: generateId('msg_'),
      conversationId,
      senderType: 'bot',
      senderId: activeBot.id,
      senderName: activeBot.name,
      senderAvatar: activeBot.avatar,
      senderColor: activeBot.color,
      content: event.error
        ? `${event.toolName === DELEGATE_TOOL ? 'Delegation' : event.toolName} failed: ${event.error}`
        : event.toolName === DELEGATE_TOOL
          ? `${activeBot.name} is waiting on ${String(event.result?.from || 'the specialist')}...`
          : `Result from ${event.toolName}:`,
      type: 'tool_result',
      metadata: {
        toolResult: {
          callId: event.callId,
          toolName: event.toolName,
          result: event.result,
          status: event.status === 'success' ? 'success' : 'error',
          durationMs: event.durationMs,
        },
        // Lets the client render a "Connect this service" card
        missingPluginSlug: event.missingPluginSlug,
      },
      timestamp: new Date().toISOString(),
    };
    await createMessage(resultMsg);
    returnedMessages.push(resultMsg);
  }

  // Waiting on a human: the turn ends here, the approval card is the answer
  if (turn.waitingForApproval) {
    return res.json({ messages: returnedMessages, activeBot, requiresApproval: true });
  }

  if (turn.error || !turn.text) {
    const needsKey = turn.error?.kind === 'not_configured';
    const errorMsg: Message = {
      id: generateId('msg_'),
      conversationId,
      senderType: 'system',
      senderId: 'sys',
      senderName: 'System',
      content: needsKey
        ? 'This bot has no API key yet. Open bot settings, add the bot API key, and press Verify.'
        : `Couldn't get a reply from ${activeBot.name}: ${turn.error?.message || 'empty response.'}`,
      type: 'system',
      timestamp: new Date().toISOString(),
    };
    await createMessage(errorMsg);
    returnedMessages.push(errorMsg);
    return res.json({ messages: returnedMessages, activeBot, requiresApproval: false });
  }

  const botMsg: Message = {
    id: generateId('msg_'),
    conversationId,
    senderType: 'bot',
    senderId: activeBot.id,
    senderName: activeBot.name,
    senderAvatar: activeBot.avatar,
    senderColor: activeBot.color,
    content: turn.text,
    type: 'text',
    metadata: {
      tokenUsage: turn.tokenUsage
        ? {
            promptTokens: turn.tokenUsage.promptTokens,
            completionTokens: turn.tokenUsage.completionTokens,
            totalTokens: turn.tokenUsage.totalTokens,
            estimatedCostUsd: 0,
          }
        : undefined,
    },
    timestamp: new Date().toISOString(),
  };

  await createMessage(botMsg);
  returnedMessages.push(botMsg);
  await touchConversation(conversationId, turn.text.slice(0, 60));

  res.json({ messages: returnedMessages, activeBot });
}));

/**
 * POST /api/approvals/:id/resolve — approve or reject a pending tool action.
 * Approving runs the tool for real through the gateway and posts its result.
 */
router.post('/approvals/:id/resolve', asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status, rejectionReason } = req.body as { status?: 'approved' | 'rejected'; rejectionReason?: string };

  if (status !== 'approved' && status !== 'rejected') {
    return res.status(400).json({ error: 'status must be "approved" or "rejected"' });
  }

  const resolved = await resolveApproval(id, status, req.user!.name);

  if (!resolved.approval) {
    return res.status(404).json({ error: 'Approval not found' });
  }

  // Attach the real tool result to the conversation the approval came from
  let toolResultMessage: Message | null = null;
  if (status === 'approved' && resolved.outcome && resolved.outcome.kind === 'result' && resolved.approval.conversationId) {
    toolResultMessage = {
      id: generateId('msg_'),
      conversationId: resolved.approval.conversationId,
      senderType: 'bot',
      senderId: resolved.approval.botId,
      senderName: resolved.approval.botName,
      content: resolved.outcome.ok
        ? `Result from ${resolved.outcome.toolName}:`
        : `${resolved.outcome.toolName} failed: ${String((resolved.outcome.result as any)?.error ?? 'unknown error')}`,
      type: 'tool_result',
      metadata: {
        toolResult: {
          callId: resolved.approval.id,
          toolName: resolved.outcome.toolName,
          result: resolved.outcome.result,
          status: resolved.outcome.ok ? 'success' : 'error',
          durationMs: resolved.outcome.durationMs,
        },
      },
      timestamp: new Date().toISOString(),
    };
    await createMessage(toolResultMessage);
    await touchConversation(resolved.approval.conversationId, (toolResultMessage.content || '').slice(0, 60));
  }

  res.json({ approval: resolved.approval, toolResult: toolResultMessage });
}));

/**
 * POST /api/conversations/:id/run-tool — runs one tool directly (from the
 * chat composer or a plugin card), still through the gateway.
 */
router.post('/conversations/:id/run-tool', asyncHandler(async (req: Request, res: Response) => {
  const { id } = req.params;
  const { toolName, args } = req.body as { toolName?: string; args?: Record<string, any> };

  if (!toolName) return res.status(400).json({ error: 'toolName is required' });

  const conv = await findConversationById(id);
  if (!conv) return res.status(404).json({ error: 'Conversation not found' });

  const bot = conv.participantBotIds.length > 0 ? await findBotById(conv.participantBotIds[0]) : null;
  if (!bot) return res.status(400).json({ error: 'This conversation has no bot' });

  const outcome = await callTool({
    userId: conv.userId,
    botId: bot.id,
    botName: bot.name,
    conversationId: id,
    toolName,
    args: args || {},
  });

  res.json({ outcome });
}));

export default router;