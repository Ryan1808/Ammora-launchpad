# GiwaLaunch — Launchpad dengan Ammora SDK di GIWA Sepolia

Launchpad token untuk testnet **GIWA Sepolia (Chain ID 91342)**, dibuat dengan **`@ammora-protocol/sdk@0.3.9`** + viem + Vite. Proyek ini untuk **Ammora Season 2 Builder Mission**.

## Fitur
- **Connect MetaMask**: otomatis menambahkan atau pindah ke jaringan GIWA Sepolia (RPC `https://sepolia-rpc.giwa.io`, explorer `https://sepolia-explorer.giwa.io`).
- **Explore**: daftar launch token terbaru dari Ammora V4 LaunchFactory. Isinya nama, simbol, status curve, progres graduation, dan jumlah WETH yang terkumpul. Semua data dibaca langsung dari chain.
- **Detail token + Buy/Sell**: quote live lewat `AmmoraV4LaunchCurveClient`. Swap dibuat dengan `planSwapExactInput` (slippage 1%), approve dicek dulu, lalu transaksi ditandatangani di wallet kamu. Ada tombol **Wrap ETH → WETH** karena pembelian memakai WETH.
- **Create Token**: membuat token baru beserta bonding curve dengan `buildCreateAmmoraV4Launch`. Hasilnya dibaca dengan `parseAmmoraV4LaunchCreatedReceipt`.
- **Pengaman**:
  - Config 6, config yang disabled, dan config dengan `migrationBaseThreshold = 0` diblokir.
  - Setiap transaksi disimulasikan dulu sebelum dikirim.
  - **Tidak ada private key di kode.** Semua transaksi ditandatangani di wallet pengguna.

## Ganti nama proyek
Buka `src/config.ts`, lalu ubah `PROJECT_NAME`, `PROJECT_TAGLINE`, dan judul di `index.html`.
Config default untuk form Create ada di `DEFAULT_CONFIG_ID` (sekarang `67`, config aktif yang paling banyak dipakai komunitas). Kalau mau, buat Config launchpad sendiri dengan perintah `launch:team-config` dari repo `ammora-examples`, lalu isi ID-nya di sini. Dengan begitu, fee partner masuk ke wallet kamu.

## Jalankan lokal / di Codespace
```bash
npm ci --ignore-scripts
npm run dev        # buka port 5173
npm run build      # hasil statis ada di folder dist/
npm run live-check # cek baca data on-chain dari Node (tanpa key)
```
> Kalau Codespace hanya menampilkan "Index of …" (daftar file), artinya yang jalan adalah file server biasa. Jalankan `npm run dev`, lalu buka port **5173**.

## Deploy ke Vercel (paling gampang)
1. Push folder ini ke repo GitHub kamu (misalnya `Ammora-launchpad`).
2. Buka https://vercel.com, login dengan GitHub, lalu pilih **Add New → Project** dan pilih repo tersebut.
3. Framework: **Vite**, Build command: `npm run build`, Output: `dist`. Klik **Deploy**.
4. Kamu akan dapat link seperti `https://ammora-launchpad.vercel.app`. Link inilah yang diisi di kolom **Website link**.

## Deploy ke GitHub Pages
1. Push ke branch `main`. Workflow `.github/workflows/deploy.yml` sudah tersedia.
2. Di GitHub, buka **Settings → Pages → Source: GitHub Actions**.
3. Tunggu workflow selesai. Link-nya berbentuk `https://<username>.github.io/<repo>/`.
   (`base: './'` di `vite.config.ts` sudah diatur supaya jalan di subpath.)

## Submit Builder Mission
1. Buka website-mu, connect wallet, lalu coba **Buy** atau **Create Token** sekali supaya ada bukti transaksi.
2. Posting di X: screenshot, link website, dan tag **@AmmoraHQ**.
3. Di ammora.org, buka **Builder mission → Submit your build**, lalu isi nama proyek, website link, dan link postingan X.

## Catatan
- Ini testnet. Tidak ada nilai uang sungguhan.
- Ammora SDK masih beta dan belum diaudit.
