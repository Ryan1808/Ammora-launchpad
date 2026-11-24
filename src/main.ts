import "./style.css";
import { formatUnits, parseUnits, erc20Abi, type Address, type WalletClient } from "viem";
import { buildCreateAmmoraV4Launch, classifyAmmoraV4ExactInputFill, parseAmmoraV4LaunchCreatedReceipt, planCreateAmmoraV4Config, parseAmmoraV4ConfigCreatedReceipt } from "@ammora-protocol/sdk";
import { DEFAULT_CONFIG_ID, TEMPLATE_CONFIG_ID, LAUNCH_FACTORY, CONFIG_REGISTRY, LAUNCH_LIST_LIMIT, PROJECT_NAME, PROJECT_TAGLINE, SLIPPAGE_BPS, WETH, CHAIN_ID } from "./config";
import {
  addrLink, configProblem, connectWallet, curveClient, curveState, ensureAllowance, ethereum, fetchLaunches, nextConfigId,
  parseMetadata, publicClient, readConfig, sendTx, short, STATUS_LABEL, tokenInfo, txLink, waitOk, giwaSepolia, type Launch,
} from "./chain";

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const fmt = (v: bigint, d: number, max = 6) => {
  const s = formatUnits(v, d);
  const [i, f = ""] = s.split(".");
  const fr = f.slice(0, max).replace(/0+$/, "");
  return Number(i).toLocaleString("en-US") + (fr ? "." + fr : "");
};
const errMsg = (e: any) => esc(e?.shortMessage || e?.details || e?.message || String(e)).slice(0, 300);

let wallet: WalletClient | null = null;
let account: Address | null = null;

document.title = `${PROJECT_NAME} · Ammora SDK on GIWA Sepolia`;
$("#app").innerHTML = `
<header class="top">
  <div class="brand"><span class="logo">◆</span><div><b>${esc(PROJECT_NAME)}</b><small>${esc(PROJECT_TAGLINE)}</small></div></div>
  <button id="connect" class="btn primary">Connect Wallet</button>
</header>
<nav class="tabs">
  <button data-tab="explore" class="active">Explore</button>
  <button data-tab="create">Create Token</button>
  <button data-tab="about">About</button>
</nav>
<main>
  <section id="tab-explore">
    <div class="stats" id="stats"><div class="stat"><span>Network</span><b>GIWA Sepolia · ${CHAIN_ID}</b></div><div class="stat"><span>Latest block</span><b id="st-block">…</b></div><div class="stat"><span>Launch configs</span><b id="st-configs">…</b></div><div class="stat"><span>Factory</span><b><a target="_blank" rel="noopener" href="${addrLink(LAUNCH_FACTORY)}">${short(LAUNCH_FACTORY)}</a></b></div></div>
    <div class="row-head"><h2>Recent launches</h2><button id="refresh" class="btn ghost sm">Refresh</button></div>
    <p class="muted" id="list-src"></p>
    <div id="launches" class="grid"><div class="skeleton">Loading live launches from GIWA Sepolia…</div></div>
  </section>
  <section id="tab-create" hidden>
    <h2>Create a token</h2>
    <p class="muted">Creates a new token + bonding curve through the Ammora V4 LaunchFactory. Signed by your own wallet.</p>
    <div class="card form" id="own-config">
      <b>Your launchpad Config</b>
      <p class="muted">Create your own Config so the partner fees from tokens launched here go to <i>your</i> wallet. It copies the reviewed settings of Config #${TEMPLATE_CONFIG_ID} and replaces every partner recipient with your connected address. One-time, signed by your wallet (testnet gas only).</p>
      <button id="oc-submit" class="btn ghost wide">Create my Config (fees → my wallet)</button>
      <div id="oc-status" class="status"></div>
    </div>
    <div class="card form">
      <label>Token name<input id="c-name" maxlength="40" placeholder="Giwa Cat" /></label>
      <label>Symbol<input id="c-symbol" maxlength="11" placeholder="GCAT" /></label>
      <label>Description<textarea id="c-desc" rows="3" maxlength="280" placeholder="What is this token about?"></textarea></label>
      <label>Image URL (optional)<input id="c-img" placeholder="https://… or ipfs://…" /></label>
      <label>Launch Config ID<input id="c-config" inputmode="numeric" value="${initialConfigId()}" /></label>
      <div id="c-config-info" class="note">Reading config…</div>
      <button id="c-submit" class="btn primary wide">Create token</button>
      <div id="c-status" class="status"></div>
    </div>
  </section>
  <section id="tab-about" hidden>
    <h2>About ${esc(PROJECT_NAME)}</h2>
    <div class="card prose">
      <p><b>${esc(PROJECT_NAME)}</b> is an independent launchpad for the GIWA Sepolia testnet, built on <b>@ammora-protocol/sdk@0.3.9</b>.</p>
      <ul>
        <li>Launch discovery: LaunchFactory <code>LaunchCreated</code> events decoded with the SDK ABI.</li>
        <li>Live curve state, graduation progress and quotes: <code>AmmoraV4LaunchCurveClient</code>.</li>
        <li>Buy / sell: <code>planSwapExactInput</code> with ${SLIPPAGE_BPS / 100}% slippage, approvals checked first.</li>
        <li>Token creation: <code>buildCreateAmmoraV4Launch</code>, receipt parsed with <code>parseAmmoraV4LaunchCreatedReceipt</code>.</li>
      </ul>
      <p>All transactions are simulated first and signed in your own wallet. No private keys, no server signer. Testnet only — no real value.</p>
      <p class="muted">Factory <a target="_blank" rel="noopener" href="${addrLink(LAUNCH_FACTORY)}">${LAUNCH_FACTORY}</a><br/>Config registry <a target="_blank" rel="noopener" href="${addrLink(CONFIG_REGISTRY)}">${CONFIG_REGISTRY}</a></p>
    </div>
  </section>
</main>
<div id="modal" class="modal" hidden><div class="sheet"><button class="close" id="m-close" aria-label="Close">×</button><div id="m-body"></div></div></div>
<footer>Built with <a href="https://ammora.org" target="_blank" rel="noopener">Ammora SDK</a> on GIWA Sepolia</footer>
`;

// ---------- tabs ----------
document.querySelectorAll<HTMLButtonElement>(".tabs button").forEach((b) =>
  b.addEventListener("click", () => {
    document.querySelectorAll(".tabs button").forEach((x) => x.classList.toggle("active", x === b));
    for (const t of ["explore", "create", "about"]) $(`#tab-${t}`).hidden = t !== b.dataset.tab;
  }),
);

// ---------- wallet ----------
function renderWallet() {
  const btn = $("#connect");
  btn.textContent = account ? short(account) : "Connect Wallet";
  btn.classList.toggle("connected", !!account);
}
$("#connect").addEventListener("click", async () => {
  try {
    ({ wallet, account } = await connectWallet());
    renderWallet();
  } catch (e) { alert(String((e as any)?.message || e)); }
});
ethereum()?.on?.("accountsChanged", (a: Address[]) => { account = a[0] ?? null; if (!account) wallet = null; renderWallet(); });
async function requireWallet() {
  if (!wallet || !account) ({ wallet, account } = await connectWallet());
  renderWallet();
  return { w: wallet!, a: account! };
}

// ---------- explore ----------
async function loadStats() {
  try {
    const [b, n] = await Promise.all([publicClient.getBlockNumber(), nextConfigId()]);
    $("#st-block").textContent = b.toLocaleString("en-US");
    $("#st-configs").textContent = (n - 1n).toString();
  } catch { $("#st-block").textContent = "RPC error"; }
}

let launches: Launch[] = [];
async function loadLaunches() {
  const box = $("#launches");
  box.innerHTML = `<div class="skeleton">Loading live launches from GIWA Sepolia…</div>`;
  try {
    const r = await fetchLaunches(LAUNCH_LIST_LIMIT);
    launches = r.launches;
    $("#list-src").textContent = `${launches.length} latest launches · source: ${r.source}`;
    box.innerHTML = launches.map((l, i) => `
      <button class="card launch" data-i="${i}">
        <div class="avatar" id="av-${i}">?</div>
        <div class="meta"><b id="nm-${i}">${short(l.token)}</b><small id="sy-${i}">config #${l.configId}</small></div>
        <span class="pill" id="stt-${i}">…</span>
        <div class="bar"><i id="pg-${i}" style="width:0%"></i></div>
        <small class="muted" id="rs-${i}"></small>
      </button>`).join("") || `<div class="skeleton">No launches found.</div>`;
    box.querySelectorAll<HTMLButtonElement>(".launch").forEach((el) => el.addEventListener("click", () => openLaunch(launches[+el.dataset.i!])));
    // Show metadata name/symbol immediately when the launch carries inline metadata.
    launches.forEach((l, i) => {
      const md = parseMetadata(l.metadataURI) as any;
      if (md.name) $(`#nm-${i}`).textContent = String(md.name);
      if (md.symbol) { $(`#sy-${i}`).textContent = `$${md.symbol} · config #${l.configId}`; $(`#av-${i}`).textContent = String(md.symbol).slice(0, 2).toUpperCase(); }
    });
    const fillToken = async (l: Launch, i: number) => {
      for (let attempt = 0; attempt < 3; attempt++) try {
        const t = await tokenInfo(l.token);
        const md = parseMetadata(l.metadataURI);
        $(`#nm-${i}`).textContent = t.name;
        $(`#sy-${i}`).textContent = `$${t.symbol} · config #${l.configId}`;
        $(`#av-${i}`).textContent = t.symbol.slice(0, 2).toUpperCase();
        if (md.image && /^https:\/\//.test(md.image)) $(`#av-${i}`).innerHTML = `<img src="${esc(md.image)}" alt="" />`;
        return;
      } catch { await new Promise((r) => setTimeout(r, 600 * (attempt + 1))); /* keep address fallback */ }
    };
    const fillCurve = async (l: Launch, i: number) => {
      const st = $(`#stt-${i}`);
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const s = await curveState(l.curve);
          st.textContent = STATUS_LABEL[s.status] ?? String(s.status); st.className = `pill s${s.status}`;
          const pct = s.status >= 2 ? 100 : s.migrationQuoteThreshold > 0n ? Number((s.quoteReserve * 10000n) / s.migrationQuoteThreshold) / 100 : 0;
          $(`#pg-${i}`).style.width = Math.min(100, pct) + "%";
          $(`#rs-${i}`).textContent = `${fmt(s.quoteReserve, 18)} / ${fmt(s.migrationQuoteThreshold, 18)} WETH raised`;
          return;
        } catch { await new Promise((r) => setTimeout(r, 600 * (attempt + 1))); }
      }
      st.textContent = "n/a";
    };
    // Names first (cheap, batched), then curve states with limited concurrency.
    // One pass per card (name then curve), at most 4 cards at a time, so slow phones/RPCs don't time out.
    let next = 0;
    const worker = async () => { while (next < launches.length) { const i = next++; await fillToken(launches[i], i); await fillCurve(launches[i], i); } };
    await Promise.all(Array.from({ length: 4 }, worker));
  } catch (e) {
    box.innerHTML = `<div class="skeleton err">Could not load launches: ${errMsg(e)}</div>`;
  }
}
$("#refresh").addEventListener("click", () => { loadStats(); loadLaunches(); });

// ---------- launch detail ----------
const modal = $("#modal");
$("#m-close").addEventListener("click", () => (modal.hidden = true));
modal.addEventListener("click", (e) => { if (e.target === modal) modal.hidden = true; });

async function openLaunch(l: Launch) {
  modal.hidden = false;
  const body = $("#m-body");
  body.innerHTML = `<div class="skeleton">Loading curve state…</div>`;
  try {
    const head = await publicClient.getBlockNumber();
    const cc = curveClient(l.curve);
    const [t, s, prog] = await Promise.all([tokenInfo(l.token), cc.getStateAtBlock(head), cc.getMigrationProgressAtBlock(head)]);
    const md = parseMetadata(l.metadataURI);
    const quoteSym = s.quoteToken.toLowerCase() === WETH.toLowerCase() ? "WETH" : (await tokenInfo(s.quoteToken)).symbol;
    const qDec = (await tokenInfo(s.quoteToken)).decimals;
    body.innerHTML = `
      <h3>${esc(t.name)} <span class="muted">$${esc(t.symbol)}</span></h3>
      ${md.description ? `<p class="muted">${esc(md.description)}</p>` : ""}
      <div class="kv">
        <span>Status</span><b><span class="pill s${s.status}">${STATUS_LABEL[s.status] ?? s.status}</span></b>
        <span>Graduation</span><b>${(prog.progressBps / 100).toFixed(2)}%</b>
        <span>Base reserve</span><b>${fmt(s.baseReserve, t.decimals)} ${esc(t.symbol)}</b>
        <span>Quote reserve</span><b>${fmt(s.quoteReserve, qDec)} ${quoteSym}</b>
        <span>Target</span><b>${fmt(s.migrationQuoteThreshold, qDec)} ${quoteSym}</b>
        <span>Fee</span><b>${(s.currentFeeBps / 100).toFixed(2)}%</b>
        <span>Token</span><b><a target="_blank" rel="noopener" href="${addrLink(l.token)}">${short(l.token)}</a></b>
        <span>Curve</span><b><a target="_blank" rel="noopener" href="${addrLink(l.curve)}">${short(l.curve)}</a></b>
        <span>Creator</span><b><a target="_blank" rel="noopener" href="${addrLink(l.creator)}">${short(l.creator)}</a></b>
      </div>
      ${s.status === 1 ? `
      <div class="trade card">
        <div class="seg"><button data-side="buy" class="active">Buy</button><button data-side="sell">Sell</button></div>
        <label><span id="t-label">You pay (${quoteSym})</span><input id="t-amt" inputmode="decimal" placeholder="0.0001" /></label>
        <div id="t-quote" class="note">Enter an amount to get a live quote.</div>
        <div id="t-bal" class="muted small"></div>
        <button id="t-go" class="btn primary wide">Buy</button>
        <button id="t-wrap" class="btn ghost wide sm">Wrap ETH → WETH</button>
        <div id="t-status" class="status"></div>
      </div>` : `<div class="note">${s.status === 3 ? "This token has graduated to an Ammora AMM pool. Curve trading is closed." : "Curve trading is not open."}</div>`}
    `;
    if (s.status !== 1) return;
    let side: "buy" | "sell" = "buy";
    const amt = $<HTMLInputElement>("#t-amt");
    const inDec = () => (side === "buy" ? qDec : t.decimals);
    const inToken = () => (side === "buy" ? s.quoteToken : l.token);
    const outLabel = () => (side === "buy" ? t.symbol : quoteSym);
    const refreshBal = async () => {
      if (!account) { $("#t-bal").textContent = "Connect wallet to see balances."; return; }
      const [eth, qb, bb] = await Promise.all([
        publicClient.getBalance({ address: account }),
        publicClient.readContract({ address: s.quoteToken, abi: erc20Abi, functionName: "balanceOf", args: [account] }),
        publicClient.readContract({ address: l.token, abi: erc20Abi, functionName: "balanceOf", args: [account] }),
      ]);
      $("#t-bal").textContent = `Balance: ${fmt(eth, 18)} ETH · ${fmt(qb, qDec)} ${quoteSym} · ${fmt(bb, t.decimals)} ${t.symbol}`;
    };
    refreshBal();
    body.querySelectorAll<HTMLButtonElement>(".seg button").forEach((b) => b.addEventListener("click", () => {
      side = b.dataset.side as any;
      body.querySelectorAll(".seg button").forEach((x) => x.classList.toggle("active", x === b));
      $("#t-label").textContent = side === "buy" ? `You pay (${quoteSym})` : `You sell (${t.symbol})`;
      $("#t-go").textContent = side === "buy" ? "Buy" : "Sell";
      amt.value = ""; $("#t-quote").textContent = "Enter an amount to get a live quote.";
    }));
    let timer: number | undefined;
    const quote = async () => {
      const raw = amt.value.trim();
      if (!raw || Number(raw) <= 0) return null;
      const amount = parseUnits(raw, inDec());
      const q = await cc.quoteExactInput(amount, side === "sell");
      const fill = classifyAmmoraV4ExactInputFill(q, side === "sell");
      return { amount, q, fill };
    };
    amt.addEventListener("input", () => {
      clearTimeout(timer);
      timer = window.setTimeout(async () => {
        const box = $("#t-quote");
        try {
          const r = await quote();
          if (!r) { box.textContent = "Enter an amount to get a live quote."; return; }
          const extra = r.fill.kind === "graduation-boundary" ? ` · final fill: ${fmt(r.fill.refundableAmountIn, inDec())} unused input stays in your wallet` : r.fill.kind !== "full" ? " · partial fill — not executable" : "";
          box.innerHTML = `≈ <b>${fmt(r.q.amountOut, side === "buy" ? t.decimals : qDec)} ${esc(outLabel())}</b> · fee ${fmt(r.q.fee, inDec())}${extra}`;
        } catch (e) { box.innerHTML = `<span class="err">Quote failed: ${errMsg(e)}</span>`; }
      }, 350);
    });
    const status = (h: string) => ($("#t-status").innerHTML = h);
    $("#t-go").addEventListener("click", async () => {
      try {
        const { w, a } = await requireWallet();
        const r = await quote();
        if (!r) return status("Enter an amount.");
        if (r.fill.kind === "partial" || r.fill.kind === "terminal-dust") return status(`<span class="err">This order can't be filled safely right now (${r.fill.kind}).</span>`);
        const bal = await publicClient.readContract({ address: inToken(), abi: erc20Abi, functionName: "balanceOf", args: [a] });
        if (bal < r.amount) return status(`<span class="err">Insufficient ${side === "buy" ? quoteSym : t.symbol} balance.${side === "buy" && quoteSym === "WETH" ? " Use “Wrap ETH → WETH” first." : ""}</span>`);
        const plan = await cc.planSwapExactInput({
          includedAmountIn: r.amount, baseForQuote: side === "sell", allowPartialFill: r.fill.allowPartialFill,
          slippageBps: SLIPPAGE_BPS, recipient: a, deadline: BigInt(Math.floor(Date.now() / 1000) + 600),
        });
        for (const req of plan.approvalRequirements) await ensureAllowance(w, a, req.token, req.spender, req.amount, status);
        status("Confirm the swap in your wallet…");
        const hash = await sendTx(w, a, plan.transaction);
        status(`Submitted… <a target="_blank" rel="noopener" href="${txLink(hash)}">view tx</a>`);
        await waitOk(hash);
        status(`✓ Swap confirmed · <a target="_blank" rel="noopener" href="${txLink(hash)}">view tx</a>`);
        refreshBal();
      } catch (e) { status(`<span class="err">${errMsg(e)}</span>`); }
    });
    $("#t-wrap").addEventListener("click", async () => {
      try {
        const { w, a } = await requireWallet();
        const v = prompt("How much ETH to wrap into WETH?", "0.001");
        if (!v) return;
        const value = parseUnits(v.trim(), 18);
        status("Confirm wrap in your wallet…");
        const hash = await w.writeContract({ account: a, chain: giwaSepolia, address: WETH, abi: [{ type: "function", name: "deposit", stateMutability: "payable", inputs: [], outputs: [] }] as const, functionName: "deposit", value });
        await waitOk(hash);
        status(`✓ Wrapped ${esc(v)} ETH · <a target="_blank" rel="noopener" href="${txLink(hash)}">view tx</a>`);
        refreshBal();
      } catch (e) { status(`<span class="err">${errMsg(e)}</span>`); }
    });
  } catch (e) {
    body.innerHTML = `<div class="skeleton err">Could not load this launch: ${errMsg(e)}</div>`;
  }
}

// ---------- create ----------
function initialConfigId(): string {
  const q = new URLSearchParams(location.search).get("config");
  if (q && /^\d+$/.test(q)) return q;
  return DEFAULT_CONFIG_ID.toString();
}
$("#oc-submit").addEventListener("click", async () => {
  const status = (h: string) => ($("#oc-status").innerHTML = h);
  try {
    const { w, a } = await requireWallet();
    status("Reading template Config…");
    const tpl = await readConfig(TEMPLATE_CONFIG_ID);
    const c: any = { ...tpl.config, partnerRecipient: a, leftoverReceiver: a, liquidityDistribution: { ...tpl.config.liquidityDistribution, partner: a } };
    status("Simulating Config creation…");
    const plan = await planCreateAmmoraV4Config(publicClient, CONFIG_REGISTRY, c, tpl.segments, a, a);
    status("Confirm in your wallet…");
    const hash = await sendTx(w, a, { to: plan.transaction.to, data: plan.transaction.data, value: plan.transaction.value ?? 0n });
    status(`Waiting for confirmation… <a target="_blank" rel="noopener" href="${txLink(hash)}">view tx</a>`);
    const r = await waitOk(hash);
    const rc = parseAmmoraV4ConfigCreatedReceipt(r, CONFIG_REGISTRY);
    $<HTMLInputElement>("#c-config").value = rc.configId.toString();
    await checkConfig();
    status(`<span class="ok">✓ Config #${rc.configId} created. Partner fees go to ${short(a)}.</span><br/>Share links as <code>?config=${rc.configId}</code>, or set <code>DEFAULT_CONFIG_ID = ${rc.configId}n</code> in src/config.ts. <a target="_blank" rel="noopener" href="${txLink(hash)}">tx</a>`);
  } catch (e) { status(`<span class="err">${errMsg(e)}</span>`); }
});

let cfgOk = false;
let cfgSnap: Awaited<ReturnType<typeof readConfig>> | null = null;
async function checkConfig() {
  const box = $("#c-config-info");
  cfgOk = false; cfgSnap = null;
  const v = $<HTMLInputElement>("#c-config").value.trim();
  if (!/^\d+$/.test(v)) { box.innerHTML = `<span class="err">Enter a numeric Config ID.</span>`; return; }
  box.textContent = "Reading config…";
  try {
    const id = BigInt(v);
    const snap = await readConfig(id);
    const problem = configProblem(id, snap);
    const c = snap.config;
    box.innerHTML = `
      <b>Config #${id}</b> · ${snap.enabled ? "enabled" : "disabled"} · decimals ${c.tokenDecimals}<br/>
      Supply ${fmt(c.totalSupply, c.tokenDecimals, 2)} · graduates at ${fmt(c.migrationQuoteThreshold, 18)} WETH · creation fee ${fmt(c.poolCreationFee, 18)} ETH<br/>
      Partner fee recipient <a target="_blank" rel="noopener" href="${addrLink(c.partnerRecipient)}">${short(c.partnerRecipient)}</a>
      ${problem ? `<div class="err">⚠ ${esc(problem)}</div>` : `<div class="ok">✓ Usable for new launches</div>`}`;
    cfgOk = !problem; cfgSnap = snap;
  } catch (e) { box.innerHTML = `<span class="err">Config not readable: ${errMsg(e)}</span>`; }
}
let cfgTimer: number | undefined;
$("#c-config").addEventListener("input", () => { clearTimeout(cfgTimer); cfgTimer = window.setTimeout(checkConfig, 400); });

$("#c-submit").addEventListener("click", async () => {
  const status = (h: string) => ($("#c-status").innerHTML = h);
  try {
    const name = $<HTMLInputElement>("#c-name").value.trim();
    const symbol = $<HTMLInputElement>("#c-symbol").value.trim().toUpperCase();
    const description = $<HTMLTextAreaElement>("#c-desc").value.trim();
    const image = $<HTMLInputElement>("#c-img").value.trim();
    if (!name || !symbol) return status(`<span class="err">Name and symbol are required.</span>`);
    if (!/^[A-Z0-9]{1,11}$/.test(symbol)) return status(`<span class="err">Symbol: letters/numbers only, max 11.</span>`);
    await checkConfig();
    if (!cfgOk || !cfgSnap) return status(`<span class="err">Choose a usable Config first.</span>`);
    const { w, a } = await requireWallet();
    const meta: Record<string, string> = { name, symbol, description, app: PROJECT_NAME };
    if (image) meta.image = image;
    const metadataURI = "data:application/json;base64," + btoa(unescape(encodeURIComponent(JSON.stringify(meta))));
    const configId = BigInt($<HTMLInputElement>("#c-config").value.trim());
    const built = buildCreateAmmoraV4Launch(
      { name, symbol, metadataURI, creatorMetadataURI: "", tokenDecimals: cfgSnap.config.tokenDecimals },
      configId,
      cfgSnap.config.poolCreationFee,
    );
    status("Simulating, then confirm in your wallet…");
    const hash = await sendTx(w, a, { to: LAUNCH_FACTORY, data: built.data, value: built.value });
    status(`Submitted… <a target="_blank" rel="noopener" href="${txLink(hash)}">view tx</a>`);
    const receipt = await waitOk(hash);
    const res = parseAmmoraV4LaunchCreatedReceipt(receipt, LAUNCH_FACTORY);
    status(`✓ Token created! <a target="_blank" rel="noopener" href="${addrLink(res.token)}">${short(res.token)}</a> · curve <a target="_blank" rel="noopener" href="${addrLink(res.curve)}">${short(res.curve)}</a> · <a target="_blank" rel="noopener" href="${txLink(hash)}">tx</a>`);
    loadLaunches();
  } catch (e) { status(`<span class="err">${errMsg(e)}</span>`); }
});

renderWallet();
loadStats();
loadLaunches();
checkConfig();
