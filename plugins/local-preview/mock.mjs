// Recorded responses for mock mode: no server is started.
export async function start() {
  return { url: 'http://127.0.0.1:4321/', close: async () => {} };
}
