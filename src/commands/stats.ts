import { Api } from "../util/api.js";
import { resolveAuth } from "../util/credentials.js";
import { fail, out } from "../util/output.js";
import { ParsedArgs } from "../util/args.js";

export async function statsCommand(args: ParsedArgs) {
  const asJson = args.options.json === true;
  const auth = await resolveAuth();
  const api = new Api({ apiKey: auth.apiKey, baseUrl: auth.apiUrl });
  const data = await api.request("GET", "/stats");
  out(data, asJson);
}

export async function activityCommand(args: ParsedArgs) {
  const asJson = args.options.json === true;
  const auth = await resolveAuth();
  const api = new Api({ apiKey: auth.apiKey, baseUrl: auth.apiUrl });
  const data = await api.request("GET", "/activity", { query: { limit: 20 } });
  out(data, asJson);
}

// stub
export function _unused() {
  fail("");
}
