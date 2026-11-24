import { giwaSepoliaAutoRouteDeployment } from "@ammora-protocol/sdk";

/** Ganti nama proyek di sini saja. / Rename the project here only. */
export const PROJECT_NAME = "GiwaLaunch";
export const PROJECT_TAGLINE = "Launch & trade tokens on GIWA Sepolia";

export const CHAIN_ID = 91342;
export const RPC_URL = "https://sepolia-rpc.giwa.io";
export const EXPLORER_URL = "https://sepolia-explorer.giwa.io";

/** Reviewed GIWA Sepolia auto-route V4 deployment bundled in @ammora-protocol/sdk@0.3.9. */
const launch = giwaSepoliaAutoRouteDeployment.contracts.launch;
export const LAUNCH_FACTORY = launch.factory as `0x${string}`;
export const CONFIG_REGISTRY = launch.configRegistry as `0x${string}`;
export const FEE_POLICY = launch.feePolicy as `0x${string}`;
export const WETH = giwaSepoliaAutoRouteDeployment.contracts.tokens.wrappedNative as `0x${string}`;

/**
 * Default launch Config for the create form.
 * Config 6 is quarantined by Ammora docs and is always blocked in the UI.
 * Configs with migrationBaseThreshold = 0 are also blocked (same failure class).
 * Best practice: create your own launchpad Config (launch:team-config) and put its ID here.
 */
export const DEFAULT_CONFIG_ID = 67n;
export const BLOCKED_CONFIG_IDS: readonly bigint[] = [6n];

export const SLIPPAGE_BPS = 100; // 1%
export const LAUNCH_LIST_LIMIT = 24;
