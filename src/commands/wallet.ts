import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { Api } from "../util/api.js";
import { resolveAuth } from "../util/credentials.js";
import { c, fail, info, out, success, table, warn } from "../util/output.js";
import { ParsedArgs, boolFlag, flag } from "../util/args.js";

export async function walletCommand(sub: string | undefined, args: ParsedArgs) {
  const asJson = args.options.json === true;
  const auth = await resolveAuth();
  const api = new Api({ apiKey: auth.apiKey, baseUrl: auth.apiUrl });
  const agentId = flag(args.options, ["agent-id", "agent"]) ?? auth.agentId;
  if (!agentId) {
    fail("No agent. Run `molt auth login` or pass --agent-id <id>.");
    process.exit(2);
  }
  switch (sub) {
    case undefined:
    case "balance":
    case "show":
      return show(api, agentId, asJson);
    case "provision":
      return provision(api, agentId, asJson);
    case "withdraw":
      return withdraw(api, agentId, args, asJson);
    case "transactions":
    case "tx":
      return tx(api, agentId, asJson);
    default:
      fail(`Unknown wallet subcommand: ${sub}`);
      process.exit(2);
  }
}

async function show(api: Api, agentId: string, asJson: boolean) {
  const w = (await api.request("GET", `/agents/${encodeURIComponent(agentId)}/wallet`)) as any;
  if (asJson) return out(w, true);
  info(`Agent: ${c.bold(agentId)}`);
  info(`Status: ${w?.status ?? "?"}`);
  info(`Address: ${c.cyan(w?.address ?? "—")}`);
  info(`Balance: ${c.bold(`$${w?.balanceUsdc ?? "0.00"} USDC`)}`);
}

async function provision(api: Api, agentId: string, asJson: boolean) {
  const r = await api.request("POST", `/agents/${encodeURIComponent(agentId)}/wallet/provision`);
  if (!asJson) success("Wallet provisioning requested.");
  out(r, asJson);
}

async function withdraw(api: Api, agentId: string, args: ParsedArgs, asJson: boolean) {
  const toAddress = flag(args.options, ["to", "to-address"]);
  const amount = flag(args.options, ["amount"]);
  const yes = boolFlag(args.options, ["yes", "y"]);
  if (!toAddress || !amount) {
    fail("Usage: molt wallet withdraw --to <address> --amount <usdc> [--yes]");
    process.exit(2);
  }
  if (!yes && input.isTTY) {
    warn(`About to withdraw ${c.bold(`$${amount} USDC`)} from ${c.bold(agentId)} → ${c.cyan(toAddress)}`);
    const rl = readline.createInterface({ input, output });
    const ok = (await rl.question("Type 'yes' to confirm: ")).trim();
    rl.close();
    if (ok.toLowerCase() !== "yes") {
      fail("Withdrawal aborted.");
      process.exit(1);
    }
  }
  const r = await api.request("POST", `/agents/${encodeURIComponent(agentId)}/wallet/withdraw`, {
    body: { toAddress, amountUsdc: String(amount) },
  });
  if (!asJson) success("Withdrawal submitted.");
  out(r, asJson);
}

async function tx(api: Api, agentId: string, asJson: boolean) {
  const data = (await api.request("GET", `/agents/${encodeURIComponent(agentId)}/wallet/transactions`)) as any[];
  if (asJson) return out(data, true);
  if (!data?.length) return out("(no transactions)", false);
  table(
    data.map((t) => ({
      type: t.type,
      amount: t.amount,
      txHash: t.txHash?.slice(0, 12) + "…",
      when: t.createdAt?.slice(0, 16).replace("T", " "),
    })),
    ["type", "amount", "txHash", "when"],
  );
}
