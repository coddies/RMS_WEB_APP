# RMS Local Bridge Windows installer

The build creates `dist/RMSLocalBridgeSetup-1.1.3.exe`. It bundles a portable Node.js runtime and WinSW; the restaurant PC does not need Node.js or a terminal window.

## Build the installer

1. Install Inno Setup on any drive. The installer lets the restaurant choose its destination, including `C:`.
2. From this folder run:

   ```powershell
   .\build-installer.ps1 -InnoSetupCompilerPath 'Z:\Tools\Inno Setup 6\ISCC.exe'
   ```

   The build reads `NEXT_PUBLIC_SUPABASE_URL` and the public anon/publishable key from the project `.env.local`, then bakes those public values into the setup executable. Do not put a service-role/secret key in either build setting. Node.js 24.18.0 and WinSW 2.12.0 are downloaded into `build-tools` under this folder. The Node archive is checked against Node.js's published SHA256 list and WinSW against its pinned checksum. The resulting setup executable and unpacked runtime payload stay under this folder. No system Node.js install is performed.

## Install on a restaurant counter PC

1. Copy `dist/RMSLocalBridgeSetup.exe` to the counter PC and run it as an administrator.
2. Keep the suggested `Program Files\RMS Local Bridge` location or choose any drive and folder. Setup asks for one **Restaurant Pairing Key**. The installer checks it through `rms_pair_local_bridge`, obtains the matching tenant slug, and registers this PC's hashed Windows MachineGuid fingerprint.
3. Setup installs `RMS Counter` shortcuts and offers to open its native Windows window when setup finishes. On first launch, enter the separately generated **Local Counter connection token** shown by setup. The app stores that token using Windows user-scoped DPAPI. The Restaurant Pairing Key remains in the service's ACL-protected configuration and is not used as the local API token.

An onboarding service issues a key with `public.rms_issue_pairing_key(tenant_id)` using the trusted service role. The database stores only its SHA-256 verifier in `tenants.license_key`; the returned `rms_...` value must be handed to the restaurant once. Re-issuing replaces the prior verifier and clears the registered fingerprint.

Setup registers and starts the `RMS Local Bridge` automatic Windows Service under LocalService. It checks `http://127.0.0.1:8765/health` before reporting success. The SQLite queue and service logs stay beside the installation. Uninstall stops/removes the service and removes the Supabase config; non-empty SQLite data is retained.

## Deploy the web app before building a production counter installer

Deploy the **project root** (the folder containing `package.json` and `src/`) to Vercel as a Next.js app. Do not deploy `local-bridge/`; that folder is packaged into the Windows installer. Set the server environment variables from the project `.env.example` in Vercel: Supabase URL + publishable key, `SUPABASE_SECRET_KEY`, `STAFF_SESSION_SECRET`, and the Cloudinary credentials. Keep secret values server-side; never use a `NEXT_PUBLIC_` prefix for them.

After Vercel gives the project its HTTPS deployment URL, set `RMS_WEB_APP_URL` to that URL in the project `.env.local`, then rebuild the installer. The installer embeds the public Supabase URL/key and web-app URL; it never embeds `SUPABASE_SECRET_KEY`. The public customer menu and staff login APIs must be reachable at that deployment URL for pairing and online sync tests.

For development, run the service with `node .\server.mjs` from the `local-bridge` folder, then launch the native window with `powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File .\counter-app.ps1`. The first launch asks for the bridge token. A cached menu is required for offline order entry; use **Refresh** while online to populate it.

The installer contains only the public anon/publishable key. Never bake a service-role/secret key into the installer.
