import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';

import type { MotionWorksServer, MotionWorksStateManager } from '@motionworks/core/server';

import { SCHEMA_EMISSION_GUIDE, TOOL_NUDGE } from './instructions.js';
import { PACKAGE_VERSION } from './version.js';

function withNudge(description: string): string {
  return `${description} ${TOOL_NUDGE}`;
}

function textResult(payload: unknown): {
  content: [{ type: 'text'; text: string }];
} {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
  };
}

export interface McpServerBridge {
  state: MotionWorksStateManager;
  wsServer: MotionWorksServer;
}

/**
 * Builds an MCP server that exposes the seven tools defined in
 * AGENT_INTEGRATION.md against a shared MotionWorksStateManager.
 */
export function createMotionWorksMcpServer({ state, wsServer }: McpServerBridge): McpServer {
  const server = new McpServer(
    { name: 'motionworks', version: PACKAGE_VERSION },
    { capabilities: { tools: {} } },
  );

  server.registerTool(
    'motionworks_get_state',
    {
      description: withNudge(
        'Returns the full current MotionWorks state: all registered effects, the selected effect id, all queued changesets (oldest first), and any pending type corrections.',
      ),
      inputSchema: {},
    },
    async () => {
      const snapshot = state.getSnapshot();
      return textResult({
        effects: snapshot.effects,
        selectedEffectId: snapshot.selectedEffectId,
        changesets: snapshot.changesets,
        typeCorrections: snapshot.typeCorrections,
      });
    },
  );

  server.registerTool(
    'motionworks_get_selected',
    {
      description: withNudge(
        'Returns the currently selected effect (schema + current live values) or null if nothing is selected.',
      ),
      inputSchema: {},
    },
    async () => {
      const selected = state.getSelectedEffect();
      if (selected === null) {
        return textResult({ selected: null });
      }
      return textResult({
        selected: {
          id: selected.id,
          name: selected.name,
          params: selected.params,
          ...(selected.sourceHints !== undefined && { sourceHints: selected.sourceHints }),
          readOnly: selected.readOnly,
        },
      });
    },
  );

  server.registerTool(
    'motionworks_get_changes',
    {
      description: withNudge(
        'Returns all queued changesets (oldest first) and any pending type corrections. Call this before any motion-related edit so in-progress design work is not overwritten.',
      ),
      inputSchema: {},
    },
    async () => {
      const snapshot = state.getSnapshot();
      return textResult({
        changesets: snapshot.changesets,
        typeCorrections: snapshot.typeCorrections,
      });
    },
  );

  server.registerTool(
    'motionworks_clear_changes',
    {
      description: withNudge(
        'Acknowledges a single changeset by id and pops it from the queue. Call after successfully writing the change to source. Emits a source-synced notification to the overlay so it can reconcile.',
      ),
      inputSchema: {
        id: z
          .string()
          .min(1)
          .describe('The id of the changeset to acknowledge (from motionworks_get_changes).'),
      },
    },
    async ({ id }) => {
      const before = state.getSnapshot();
      const target = before.changesets.find((cs) => cs.id === id);
      const removed = state.clearChangeset(id);
      if (!removed || target === undefined) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ cleared: false, id, reason: 'unknown changeset id' }, null, 2),
            },
          ],
          isError: true,
        };
      }
      // Prefer the changeset's own effectId over searching by name: stagger
      // makes same-name effects common (e.g. every card in a list registers as
      // "CardEntrance"), and matching by name would notify the wrong overlay
      // entry.
      wsServer.notifySourceSynced(target.effectId);
      const after = state.getSnapshot();
      return textResult({ cleared: true, id, remaining: after.changesets.length });
    },
  );

  server.registerTool(
    'motionworks_list_effects',
    {
      description: withNudge(
        'Returns all effects registered in the current session, each with its full schema (params, source hints, read-only flag).',
      ),
      inputSchema: {},
    },
    async () => {
      return textResult({ effects: state.getAllEffects() });
    },
  );

  server.registerTool(
    'motionworks_get_instructions',
    {
      description: withNudge(
        'Returns the MotionWorks schema emission guide: the valid parameter types, the named-constant convention, and an example useMotionWorks() registration. Call this before implementing a motion effect if the CLAUDE.md stanza is not in context.',
      ),
      inputSchema: {},
    },
    async () => {
      return {
        content: [{ type: 'text', text: SCHEMA_EMISSION_GUIDE }],
      };
    },
  );

  server.registerTool(
    'motionworks_clear_type_corrections',
    {
      description: withNudge(
        'Clears the pending type-corrections queue. Call after updating each affected param\'s `type` field in the source `useMotionWorks` call.',
      ),
      inputSchema: {},
    },
    async () => {
      const before = state.getSnapshot().typeCorrections.length;
      state.clearTypeCorrections();
      return textResult({ cleared: before });
    },
  );

  return server;
}
