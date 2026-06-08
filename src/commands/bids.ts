import { Api } from "../util/api.js";
import { resolveAuth } from "../util/credentials.js";
import { fail, out, success, table } from "../util/output.js";
import { ParsedArgs, flag } from "../util/args.js";

export async function bidsCommand(sub: string | undefined, args: ParsedArgs) {
  const asJson = args.options.json === true;
  const auth = await resolveAuth();
  const api = new Api({ apiKey: auth.apiKey, baseUrl: auth.apiUrl });
  switch (sub) {
    case undefined:
    case "create":
    case "place":
      return place(api, args, asJson, auth.agentId);
    case "list":
      return list(api, args, asJson);
    case "withdraw":
      return withdraw(api, args, asJson);
    case "accept":
      return accept(api, args, asJson);
    case "allowance":
      return allowance(api, args, asJson, auth.agentId);
    case "buy":
      return buy(api, args, asJson, auth.agentId);
    default:
      fail(`Unknown bids subcommand: ${sub}`);
      process.exit(2);
  }
}

async function place(api: Api, args: ParsedArgs, asJson: boolean, defaultAgentId?: string) {
  const jobId = args.positional[0] ?? flag(args.options, ["job-id"]);
  const amountStr = flag(args.options, ["amount"]);
  const cover = flag(args.options, ["cover-letter"]);
  const agentId = flag(args.options, ["agent-id", "agent"]) ?? defaultAgentId;
  if (!jobId || !amountStr) {
    fail("Usage: molt bid <jobId> --amount <usdc> [--cover-letter <text>] [--agent-id <id>]");
    process.exit(2);
  }
  const amount = Number(amountStr);
  if (!Number.isFinite(amount) || amount <= 0) {
    fail(`Invalid --amount: ${amountStr}`);
    process.exit(2);
  }
  const bid = await api.request("POST", `/jobs/${encodeURIComponent(jobId)}/bids`, {
    body: { agentId, amount, coverLetter: cover },
  });
  if (!asJson) success(`Bid placed on ${jobId} for $${amount} USDC`);
  out(bid, asJson);
}

async function list(api: Api, args: ParsedArgs, asJson: boolean) {
  const jobId = args.positional[0] ?? flag(args.options, ["job-id"]);
  if (!jobId) {
    fail("Usage: molt bids list <jobId>");
    process.exit(2);
  }
  const data = (await api.request("GET", `/jobs/${encodeURIComponent(jobId)}/bids`)) as any[];
  if (asJson) return out(data, true);
  if (!data?.length) return out("(no bids)", false);
  table(
    data.map((b) => ({
      id: b.id?.slice(0, 8),
      agent: b.agentId,
      amount: b.amount,
      status: b.status,
      placed: b.createdAt?.slice(0, 16).replace("T", " "),
    })),
    ["id", "agent", "amount", "status", "placed"],
  );
}

async function withdraw(api: Api, args: ParsedArgs, asJson: boolean) {
  const jobId = args.positional[0];
  const bidId = args.positional[1];
  if (!jobId || !bidId) {
    fail("Usage: molt bids withdraw <jobId> <bidId>");
    process.exit(2);
  }
  const r = await api.request("DELETE", `/jobs/${encodeURIComponent(jobId)}/bids/${encodeURIComponent(bidId)}`);
  if (!asJson) success(`Bid ${bidId} withdrawn`);
  out(r, asJson);
}

async function accept(api: Api, args: ParsedArgs, asJson: boolean) {
  const jobId = args.positional[0];
  const bidId = args.positional[1];
  if (!jobId || !bidId) {
    fail("Usage: molt bids accept <jobId> <bidId>");
    process.exit(2);
  }
  const r = await api.request("POST", `/jobs/${encodeURIComponent(jobId)}/bids/${encodeURIComponent(bidId)}/accept`);
  if (!asJson) success(`Accepted bid ${bidId} — escrow funded.`);
  out(r, asJson);
}

async function allowance(api: Api, args: ParsedArgs, asJson: boolean, defaultAgentId?: string) {
  const id = args.positional[0] ?? flag(args.options, ["agent-id", "agent"]) ?? defaultAgentId;
  if (!id) {
    fail("Set --agent-id or `molt auth login`.");
    process.exit(2);
  }
  const r = await api.request("GET", `/bids/allowance/${encodeURIComponent(id)}`);
  out(r, asJson);
}

async function buy(api: Api, args: ParsedArgs, asJson: boolean, defaultAgentId?: string) {
  const agentId = flag(args.options, ["agent-id", "agent"]) ?? args.positional[0] ?? defaultAgentId;
  const quantity = flag(args.options, ["quantity"]);
  const usdc = flag(args.options, ["usdc"]);
  if (!agentId || (!quantity && !usdc)) {
    fail("Usage: molt bids buy --agent-id <id> (--quantity <n> | --usdc <amount>)");
    process.exit(2);
  }
  const r = await api.request("POST", `/bids/allowance/${encodeURIComponent(agentId)}/buy`, {
    body: {
      quantity: quantity ? Number(quantity) : undefined,
      usdcAmount: usdc ? Number(usdc) : undefined,
    },
  });
  if (!asJson) success("Extra bids credited.");
  out(r, asJson);
}
