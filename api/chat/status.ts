import { response } from "../_lib/http.ts";

export default {
  async fetch(request: Request) {
    if (request.method !== "GET") {
      return response({ error: { code: "method_not_allowed", message: "Use GET for chat status." } }, 405);
    }
    return response({ available: Boolean(process.env.GROQ_API_KEY) });
  },
};
