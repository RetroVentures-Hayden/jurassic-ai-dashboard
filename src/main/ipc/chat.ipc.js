const { chatWithOllama, checkOllamaStatus } = require('../services/ollamaService');

module.exports = function registerChatIpc(ipcMain, db) {
  ipcMain.handle('chat:status', () => checkOllamaStatus());

  ipcMain.handle('chat:send', async (_event, messages) => {
    // Lightweight RAG: if the user's message mentions a known animal by
    // name, prepend its DB description as grounding context for the model.
    // Filtered in SQL (message LIKE '%' || common_name || '%') rather than
    // pulling every row into JS, since the animals table now has 10,000+
    // rows after the bulk PBDB/GBIF imports.
    const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user');
    let context = '';
    if (lastUserMessage) {
      const matches = await db.all(
        `SELECT common_name, scientific_name, description FROM animals
         WHERE ? LIKE '%' || LOWER(common_name) || '%'
         LIMIT 3`,
        [lastUserMessage.content.toLowerCase()]
      );
      if (matches.length) {
        context = matches
          .map((m) => `${m.common_name} (${m.scientific_name || 'unknown species'}): ${m.description || 'no description on file'}`)
          .join('\n');
      }
    }

    const systemPrompt = context
      ? `You are a helpful assistant inside a Jurassic Park/World fan dashboard. Use this local reference data if relevant to the user's question:\n${context}`
      : 'You are a helpful assistant inside a Jurassic Park/World fan dashboard, knowledgeable about the film franchise and real dinosaurs/prehistoric animals.';

    return chatWithOllama([{ role: 'system', content: systemPrompt }, ...messages]);
  });
};
