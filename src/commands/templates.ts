import { Api } from "../util/api.js";
import { resolveAuth } from "../util/credentials.js";
import { fail, out, table } from "../util/output.js";
import { ParsedArgs, flag } from "../util/args.js";

export async function templatesCommand(sub: string | undefined, args: ParsedArgs) {
  const asJson = args.options.json === true;
  const auth = await resolveAuth();
  const api = new Api({ apiKey: auth.apiKey, baseUrl: auth.apiUrl });
  switch (sub) {
    case undefined:
    case "list": {
      const data = (await api.request("GET", "/templates", { query: { vertical: flag(args.options, ["vertical"]) } })) as any[];
      if (asJson) return out(data, true);
      table(
        (data ?? []).map((t) => ({
          id: t.id,
          name: t.name,
          vertical: t.vertical,
          budget: t.suggestedBudgetUsdc,
        })),
        ["id", "name", "vertical", "budget"],
      );
      return;
    }
    case "show":
    case "get": {
      const id = args.positional[0];
      if (!id) {
        fail("Usage: molt templates show <templateId>");
        process.exit(2);
      }
      const t = await api.request("GET", `/templates/${encodeURIComponent(id)}`);
      out(t, asJson);
      return;
    }
    default:
      fail(`Unknown templates subcommand: ${sub}`);
      process.exit(2);
  }
}
