import {
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  decodeEventLog,
  erc20Abi,
  http,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import {
  ammoraLaunchFactoryV4Abi,
  AmmoraV4LaunchCurveClient,
  getAmmoraV4ConfigAtBlock,
  getAmmoraV4NextConfigId,
  type AmmoraV4ConfigSnapshot,
  type AmmoraV4LaunchCurveState,
} from "@ammora-protocol/sdk";
import {
  BLOCKED_CONFIG_IDS,
  CHAIN_ID,
  CONFIG_REGISTRY,
  EXPLORER_URL,
  FEE_POLICY,
  LAUNCH_FACTORY,
  RPC_URL,
} from "./config";

export const giwaSepolia = defineChain({
  id: CHAIN_ID,
  name: "GIWA Sepolia",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  blockExplorers: { default: { name: "GIWA Explorer", url: EXPLORER_URL } },
  testnet: true,
});

export const publicClient = createPublicClient({
  chain: { ...giwaSepolia, contracts: { multicall3: { address: "0xcA11bde05977b3631167028862bE2a173976CA11" } } },
  // Batch calls (multicall + JSON-RPC batching) so the browser doesn't fire hundreds of parallel requests.
  batch: { multicall: { wait: 16 } },
  transport: http(RPC_URL, { timeout: 20_000, retryCount: 3, retryDelay: 400 }),
}) as PublicClient;

export const curveClient = (curve: Address) =>
  new AmmoraV4LaunchCurveClient(publicClient, curve, { launchFactory: LAUNCH_FACTORY, feePolicy: FEE_POLICY });

// ---------- wallet ----------
type Eip1193 = { request: (a: { method: string; params?: unknown[] }) => Promise<any>; on?: (e: string, f: (...a: any[]) => void) => void };
export const ethereum = (): Eip1193 | undefined => (window as any).ethereum;

export async function ensureGiwaChain(): Promise<void> {
  const eth = ethereum();
  if (!eth) throw new Error("Wallet tidak ditemukan. Buka di MetaMask browser / install MetaMask.");
  const hexId = "0x" + CHAIN_ID.toString(16);
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexId }] });
  } catch (err: any) {
    if (err?.code === 4902 || /Unrecognized chain|not been added/i.test(String(err?.message))) {
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: hexId,
          chainName: "GIWA Sepolia",
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: [RPC_URL],
          blockExplorerUrls: [EXPLORER_URL],
        }],
      });
    } else throw err;
  }
}

export async function connectWallet(): Promise<{ wallet: WalletClient; account: Address }> {
  const eth = ethereum();
  if (!eth) throw new Error("Wallet tidak ditemukan. Buka situs ini di browser MetaMask.");
  const accounts: Address[] = await eth.request({ method: "eth_requestAccounts" });
  await ensureGiwaChain();
  const wallet = createWalletClient({ chain: giwaSepolia, transport: custom(eth), account: accounts[0] });
  return { wallet, account: accounts[0] };
}

/** Simulate, then let the user's wallet sign. Never uses a local key. */
export async function sendTx(wallet: WalletClient, account: Address, tx: { to: Address; data: Hex; value?: bigint }): Promise<Hex> {
  const chainId = await wallet.getChainId();
  if (chainId !== CHAIN_ID) await ensureGiwaChain();
  await publicClient.call({ account, to: tx.to, data: tx.data, value: tx.value ?? 0n });
  return wallet.sendTransaction({ account, chain: giwaSepolia, to: tx.to, data: tx.data, value: tx.value ?? 0n });
}

export async function waitOk(hash: Hex) {
  const r = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (r.status !== "success") throw new Error("Transaksi gagal (reverted): " + hash);
  return r;
}

export async function ensureAllowance(wallet: WalletClient, account: Address, token: Address, spender: Address, amount: bigint, onStatus: (s: string) => void) {
  const current = await publicClient.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [account, spender] });
  if (current >= amount) return;
  onStatus("Menyetujui token (approve)… konfirmasi di wallet");
  const hash = await wallet.writeContract({ account, chain: giwaSepolia, address: token, abi: erc20Abi, functionName: "approve", args: [spender, amount] });
  await waitOk(hash);
}

// ---------- launches ----------
export type Launch = {
  token: Address;
  curve: Address;
  creator: Address;
  configId: bigint;
  metadataURI: string;
  blockNumber: bigint;
  timestamp?: string;
};

const launchEvent = ammoraLaunchFactoryV4Abi.find((x: any) => x.type === "event" && x.name === "LaunchCreated") as any;

function decodeLaunch(topics: Hex[], data: Hex): Omit<Launch, "blockNumber" | "timestamp"> | null {
  try {
    const d: any = decodeEventLog({ abi: ammoraLaunchFactoryV4Abi, data, topics: topics as any });
    if (d.eventName !== "LaunchCreated") return null;
    return { token: d.args.token, curve: d.args.curve, creator: d.args.creator, configId: d.args.configId, metadataURI: d.args.metadataURI };
  } catch { return null; }
}

/** Primary: GIWA Blockscout log index (CORS-enabled). Logs are decoded locally with the SDK's factory ABI. */
async function launchesFromExplorer(limit: number): Promise<Launch[]> {
  const out: Launch[] = [];
  let url: string | null = `${EXPLORER_URL}/api/v2/addresses/${LAUNCH_FACTORY}/logs`;
  for (let page = 0; page < 6 && url && out.length < limit; page++) {
    const res: Response = await fetch(url);
    if (!res.ok) throw new Error("explorer " + res.status);
    const j: any = await res.json();
    for (const it of j.items ?? []) {
      const l = decodeLaunch((it.topics ?? []).filter(Boolean), it.data);
      if (l) out.push({ ...l, blockNumber: BigInt(it.block_number), timestamp: it.block_timestamp });
    }
    url = j.next_page_params ? `${EXPLORER_URL}/api/v2/addresses/${LAUNCH_FACTORY}/logs?` + new URLSearchParams(j.next_page_params) : null;
  }
  return out.slice(0, limit);
}

/** Fallback: RPC getLogs (GIWA RPC caps ranges at 10,000 blocks). */
async function launchesFromRpc(limit: number): Promise<Launch[]> {
  const head = await publicClient.getBlockNumber();
  const out: Launch[] = [];
  for (let i = 0n; i < 12n && out.length < limit; i++) {
    const to = head - i * 10_000n;
    const from = to - 9_999n;
    const logs = await publicClient.getLogs({ address: LAUNCH_FACTORY, event: launchEvent, fromBlock: from, toBlock: to });
    for (const lg of [...logs].reverse()) {
      const a: any = (lg as any).args;
      out.push({ token: a.token, curve: a.curve, creator: a.creator, configId: a.configId, metadataURI: a.metadataURI, blockNumber: lg.blockNumber! });
    }
  }
  return out.slice(0, limit);
}

export async function fetchLaunches(limit: number): Promise<{ launches: Launch[]; source: string }> {
  try {
    return { launches: await launchesFromExplorer(limit), source: "GIWA Explorer index + SDK ABI" };
  } catch {
    return { launches: await launchesFromRpc(limit), source: "GIWA RPC logs + SDK ABI" };
  }
}

export type TokenInfo = { name: string; symbol: string; decimals: number };
const tokenCache = new Map<string, Promise<TokenInfo>>();
export function tokenInfo(token: Address): Promise<TokenInfo> {
  const k = token.toLowerCase();
  if (!tokenCache.has(k)) {
    tokenCache.set(k, Promise.all([
      publicClient.readContract({ address: token, abi: erc20Abi, functionName: "name" }),
      publicClient.readContract({ address: token, abi: erc20Abi, functionName: "symbol" }),
      publicClient.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }),
    ]).then(([name, symbol, decimals]) => ({ name, symbol, decimals: Number(decimals) })));
    // Don't cache failures, so a Refresh can retry.
    tokenCache.get(k)!.catch(() => tokenCache.delete(k));
  }
  return tokenCache.get(k)!;
}

export async function curveState(curve: Address): Promise<AmmoraV4LaunchCurveState> {
  const head = await publicClient.getBlockNumber();
  return curveClient(curve).getStateAtBlock(head);
}

export const STATUS_LABEL: Record<number, string> = { 0: "Uninitialized", 1: "Trading", 2: "Ready to migrate", 3: "Graduated" };

// ---------- configs ----------
export async function readConfig(id: bigint): Promise<AmmoraV4ConfigSnapshot> {
  const head = await publicClient.getBlockNumber();
  return getAmmoraV4ConfigAtBlock(publicClient, CONFIG_REGISTRY, id, head);
}

export async function nextConfigId(): Promise<bigint> {
  const head = await publicClient.getBlockNumber();
  return getAmmoraV4NextConfigId(publicClient, CONFIG_REGISTRY, head);
}

export function configProblem(id: bigint, snap: AmmoraV4ConfigSnapshot): string | null {
  if (BLOCKED_CONFIG_IDS.includes(id)) return "Config ini dikarantina oleh Ammora (jangan dipakai untuk launch baru).";
  if (!snap.enabled) return "Config ini tidak aktif (disabled).";
  if (snap.config.migrationBaseThreshold === 0n) return "migrationBaseThreshold = 0 — risiko gagal graduation, diblokir.";
  return null;
}

/** Decode `data:application/json;base64,...` metadata (others are shown as links). */
export function parseMetadata(uri: string): { description?: string; image?: string } {
  try {
    if (uri.startsWith("data:application/json;base64,")) return JSON.parse(atob(uri.split(",")[1]));
    if (uri.startsWith("data:application/json,")) return JSON.parse(decodeURIComponent(uri.slice(22)));
  } catch { /* ignore */ }
  return {};
}

export const short = (a: string) => a.slice(0, 6) + "…" + a.slice(-4);
export const addrLink = (a: string) => `${EXPLORER_URL}/address/${a}`;
export const txLink = (h: string) => `${EXPLORER_URL}/tx/${h}`;
