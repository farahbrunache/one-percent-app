// What the voice service holds about the agent, gathered into one document.
//
// The agent record is not the script. It points at a response engine, and the engine is where
// the questions live, so both are fetched and handed over together. Two callers want this -- a
// button on the desk and a job on a clock -- and they must not drift apart, so it is written
// once here.

export async function agentScriptExport(retell, agentId) {
  const agent = await retell.agent.retrieve(agentId);
  const engine = agent.response_engine || {};

  // Which kind it is decides where the questions are kept.
  let script = null;
  if (engine.conversation_flow_id) {
    script = await retell.conversationFlow.retrieve(engine.conversation_flow_id);
  } else if (engine.llm_id) {
    script = await retell.llm.retrieve(engine.llm_id);
  }

  return {
    takenAt: new Date().toISOString(),
    agent,
    engine: engine.type || null,
    script,
    note: script
      ? null
      : `The agent names a response engine of type ${engine.type || 'unknown'}, which this does ` +
        'not know how to read. The agent itself is above; the questions are not.',
  };
}
