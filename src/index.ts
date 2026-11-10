import type { Context, Events } from '@deepseek-ai/cordis';
import type { PreStepDecision } from '@deepseek-ai/dsh-agent';

export const name = 'dsh-silent-model-switch';
export const inject = [];

export function apply(ctx: Context): void {
  const filter: Events['agent/pre-step'] = async (
    _payload,
    next,
  ): Promise<PreStepDecision> => {
    const decision = await next();

    // Preserve decisions made by downstream handlers. This plugin never creates
    // a reject decision of its own.
    if (decision.kind !== 'enter') return decision;

    const filtered = decision.messages.filter(
      (message) => message.source?.kind !== 'model-selection',
    );

    // Keep the original decision (and its message-array identity) when there is
    // nothing to remove.
    if (filtered.length === decision.messages.length) return decision;

    // Preserve any additional enter-decision metadata supported by DSH.
    return { ...decision, messages: filtered };
  };

  // The built-in switch-notice listener prepends itself and appends its message
  // after next(). Our filter must wrap it, so it runs last on the return path.
  const listen = () => ctx.on('agent/pre-step', filter, { prepend: true });
  let dispose = listen();

  // A future agent installs its built-in listener during setup, after this
  // plugin may have loaded. Re-prepend after setup, before the agent can run.
  // Retire the old registration first: keep one filter, owned by this plugin.
  ctx.on('agent/created', () => {
    dispose();
    dispose = listen();
    return undefined;
  });
}
