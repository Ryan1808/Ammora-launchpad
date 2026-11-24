// Read-only live check against GIWA Sepolia RPC. No keys, no sends.
import { createPublicClient, http, parseAbiItem, formatUnits } from "viem";
import {
  giwaSepoliaAutoRouteDeployment as dep,
  ammoraLaunchFactoryV4Abi,
  getAmmoraV4NextConfigId,
  getAmmoraV4ConfigAtBlock,
  AmmoraV4LaunchCurveClient,
} from "@ammora-protocol/sdk";

const rpc = "https://sepolia-rpc.giwa.io";
const client = createPublicClient({ transport: http(rpc, { timeout: 30000 }) });
const L = dep.contracts.launch;
console.log("factory", L.factory, "registry", L.configRegistry, "feePolicy", L.feePolicy);
const chainId = await client.getChainId();
const head = await client.getBlockNumber();
console.log("chainId", chainId, "head", head);

const next = await getAmmoraV4NextConfigId(client, L.configRegistry, head);
console.log("nextConfigId", next);
for (const id of [6n, 10n, 67n, 89n, 90n]) {
  try {
    const c = await getAmmoraV4ConfigAtBlock(client, L.configRegistry, id, head);
    console.log("config", id, "enabled", c.enabled, "quote", c.config.quoteToken, "fee", c.config.poolCreationFee, "migBase", c.config.migrationBaseThreshold, "migQuote", c.config.migrationQuoteThreshold, "owner", c.identity.owner);
  } catch (e) { console.log("config", id, "ERR", e.shortMessage || e.message); }
}

const ev = ammoraLaunchFactoryV4Abi.find((x) => x.type === "event" && x.name === "LaunchCreated");
const from = head - 9_999n;
let logs = [];
try {
  logs = await client.getLogs({ address: L.factory, event: ev, fromBlock: from, toBlock: head });
} catch (e) { console.log("getLogs ERR", e.shortMessage || e.message); }
console.log("launches in last 10k blocks:", logs.length);
const last = logs.slice(-3);
for (const l of last) {
  console.log("launch", l.args.token, l.args.curve, "cfg", l.args.configId, l.args.metadataURI?.slice(0, 60));
  const curve = new AmmoraV4LaunchCurveClient(client, l.args.curve, { launchFactory: L.factory, feePolicy: L.feePolicy });
  try {
    const s = await curve.getStateAtBlock(head);
    console.log("  status", s.status, "base", s.baseReserve, "quote", s.quoteReserve, "quoteToken", s.quoteToken);
    const q = await curve.quoteExactInputAtBlock(10n ** 13n, false, head);
    console.log("  quote 0.00001 in -> out", q.amountOut, "fee", q.fee, "left", q.amountLeft);
  } catch (e) { console.log("  curve ERR", e.shortMessage || e.message); }
}
