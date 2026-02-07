---
phase: quick
plan: 002
type: execute
wave: 1
depends_on: []
files_modified:
  - sidecar/src/network/certificate.ts
  - sidecar/src/network/trustedCa.ts
  - sidecar/src/config/schema.ts
  - sidecar/src/server.ts
  - sidecar/src/index.ts
autonomous: true

must_haves:
  truths:
    - "Browser on LAN device shows no ERR_CERT_AUTHORITY_INVALID when visiting https://church.audio:7777"
    - "CA cert is installed in Windows Trusted Root Certification Authorities store (certmgr shows it)"
    - "On domain change, only the server cert regenerates — no UAC prompt needed"
    - "On first run with no CA files, CA + server cert are generated and CA is installed (one UAC prompt)"
    - "On subsequent runs with CA already installed, no UAC prompt appears"
  artifacts:
    - path: "sidecar/src/network/trustedCa.ts"
      provides: "Root CA generation, installation, detection, and server cert signing"
    - path: "sidecar/src/network/certificate.ts"
      provides: "Server cert generation using CA (not self-signed)"
    - path: "sidecar/src/config/schema.ts"
      provides: "CA file path config fields (caCertPath, caKeyPath)"
  key_links:
    - from: "sidecar/src/network/certificate.ts"
      to: "sidecar/src/network/trustedCa.ts"
      via: "loadOrGenerateCert calls ensureCaInstalled + generateCaSignedCert"
      pattern: "ensureCa|generateCaSignedCert"
    - from: "sidecar/src/network/trustedCa.ts"
      to: "Windows cert store"
      via: "certutil -addstore Root or elevated PowerShell Import-Certificate"
      pattern: "certutil|Import-Certificate"
    - from: "sidecar/src/server.ts"
      to: "sidecar/src/network/certificate.ts"
      via: "loadOrGenerateCert (unchanged call site)"
      pattern: "loadOrGenerateCert"
---

<objective>
Replace self-signed certificate generation with a local Root CA approach: generate a persistent Root CA keypair, install it into the Windows Trusted Root Certification Authorities store (one-time UAC), and sign all server certs with that CA. This eliminates browser "ERR_CERT_AUTHORITY_INVALID" warnings on all LAN devices once they trust the CA.

Purpose: Phone browsers currently show security warnings because the server cert is self-signed. With a trusted Root CA, the cert chain validates natively.
Output: New `trustedCa.ts` module, refactored `certificate.ts`, updated config schema with CA paths.
</objective>

<execution_context>
@C:\Users\rolan\.claude/get-shit-done/workflows/execute-plan.md
@C:\Users\rolan\.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@sidecar/src/network/certificate.ts
@sidecar/src/network/hosts.ts
@sidecar/src/config/schema.ts
@sidecar/src/server.ts
@sidecar/src/index.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create Root CA module (trustedCa.ts) with generation, installation, and detection</name>
  <files>sidecar/src/network/trustedCa.ts, sidecar/src/config/schema.ts</files>
  <action>
Create `sidecar/src/network/trustedCa.ts` with these exports:

**1. `ensureCaReady(basePath, config) -> Promise<{ caCert: string, caKey: string }>`**
Main orchestrator function. Logic:
- Check if CA cert+key files exist at `basePath/ca-cert.pem` and `basePath/ca-key.pem` (paths from config.certificate.caCertPath / caKeyPath)
- If both exist, read them. Then check if CA is installed in Windows store (see detection below). If not installed, install it.
- If either missing, generate new CA keypair, save to disk, install in store.
- Return { caCert, caKey } PEM strings for use by certificate.ts.

**2. CA Generation: `generateRootCa() -> Promise<{ cert: string, key: string }>`**
Use the `selfsigned` package (already a dependency). Generate a self-signed CA certificate:
```typescript
import { generate } from "selfsigned";

const attrs = [{ name: "commonName", value: "ChurchAudioStream Local CA" }];
const notBeforeDate = new Date();
const notAfterDate = new Date();
notAfterDate.setFullYear(notAfterDate.getFullYear() + 20); // 20-year CA

const pems = await generate(attrs, {
  keySize: 2048,
  notBeforeDate,
  notAfterDate,
  extensions: [
    {
      name: "basicConstraints",
      cA: true,
      critical: true,
    },
    {
      name: "keyUsage",
      keyCertSign: true,
      cRLSign: true,
      critical: true,
    },
  ],
});
return { cert: pems.cert, key: pems.private };
```

**3. CA Installation Detection: `isCaInstalledInStore(caCertPem) -> boolean`**
Use `certutil -verifystore Root <thumbprint>` to check if the CA is already trusted.
To get the thumbprint: parse the PEM with `new crypto.X509Certificate(caCertPem)`, get `x509.fingerprint256`, strip colons, lowercase.
Alternative detection approach: use `certutil -store Root "ChurchAudioStream Local CA"` and check exit code (0 = found, non-zero = not found). This is simpler and more reliable than thumbprint matching.
Handle errors gracefully — if certutil fails, assume not installed.

**4. CA Installation: `installCaInStore(caCertPath) -> void`**
Reuse the VBS elevation pattern from `hosts.ts`. Extract and generalize:
- Create a shared `runElevatedPs1Windows(buildPs1: (sentinelPath: string) => string)` function. Since this exact function already exists in `hosts.ts`, import it from there. But hosts.ts currently does not export it — so extract `runElevatedPs1Windows` and `buildElevationVbsContent` from `hosts.ts` into a new shared utility OR simply duplicate the pattern in trustedCa.ts (preferred for SRP — each module manages its own elevation concern, and the PS1 content is completely different).

For the PS1 content that runs elevated:
```powershell
$ErrorActionPreference = 'Stop'
$caCertPath = '<path-to-ca-cert.pem>'
$sentinelPath = '<sentinel>'
try {
  Import-Certificate -FilePath $caCertPath -CertStoreLocation Cert:\LocalMachine\Root
  Set-Content -Path $sentinelPath -Value 'done'
} catch {
  Set-Content -Path $sentinelPath -Value "ERROR: $($_.Exception.Message)"
  exit 1
}
```

IMPORTANT: The elevated PS1 needs the actual ca-cert.pem file path (not temp), because the CA cert file is persistent. Pass `caCertFilePath` (the absolute path to the saved ca-cert.pem) into the PS1 builder.

Also add a `removeCaFromStore()` export for cleanup (best-effort, used on uninstall):
```powershell
$certs = Get-ChildItem Cert:\LocalMachine\Root | Where-Object { $_.Subject -eq 'CN=ChurchAudioStream Local CA' }
foreach ($cert in $certs) { Remove-Item $cert.PSPath }
```

**5. Update `CertificateSchema` in `sidecar/src/config/schema.ts`:**
Add two new fields with defaults:
```typescript
export const CertificateSchema = z.object({
  certPath: z.string().default("cert.pem"),
  keyPath: z.string().default("key.pem"),
  caCertPath: z.string().default("ca-cert.pem"),
  caKeyPath: z.string().default("ca-key.pem"),
});
```

**Key design decisions:**
- CA validity: 20 years (it is a local-only CA, long life avoids re-installation)
- Server cert validity: 825 days (Apple's max for trusted certs; shorter than CA)
- Use CN="ChurchAudioStream Local CA" so it is identifiable in certmgr.msc
- The `selfsigned` package supports `options.ca = { key, cert }` for signing — use this in Task 2
- Do NOT use `certutil -addstore` (requires being already elevated). Use Import-Certificate in an elevated PS1 via the VBS+UAC pattern.
- For non-Windows: log a warning with manual instructions (install CA cert in browser/system). Cross-platform CA install is out of scope for this task.
  </action>
  <verify>
- `npx tsc --noEmit` passes with no errors in sidecar/
- trustedCa.ts exports: ensureCaReady, isCaInstalledInStore, installCaInStore, removeCaFromStore
- CertificateSchema includes caCertPath and caKeyPath with defaults
  </verify>
  <done>
Root CA module exists with generation (selfsigned), store detection (certutil), store installation (elevated PS1 via VBS+UAC), and config schema updated with CA paths. TypeScript compiles cleanly.
  </done>
</task>

<task type="auto">
  <name>Task 2: Refactor certificate.ts to use CA-signed certs and wire into server lifecycle</name>
  <files>sidecar/src/network/certificate.ts, sidecar/src/server.ts, sidecar/src/index.ts</files>
  <action>
**1. Refactor `certificate.ts` — `loadOrGenerateCert(basePath, config)`:**

The function signature and return type stay the same (`Promise<CertificateCredentials>`), so `server.ts` call site needs no changes.

New logic flow:
```
loadOrGenerateCert(basePath, config):
  1. Call ensureCaReady(basePath, config) -> { caCert, caKey }
     This handles CA generation + store installation if needed.

  2. Check if server cert exists AND matches current domain (existing certMatchesDomain logic).
     ALSO verify the server cert was signed by the current CA:
       - Parse server cert: new crypto.X509Certificate(certPem)
       - Parse CA cert: new crypto.X509Certificate(caCertPem)
       - Check: serverX509.verify(caPublicKey) — if false, cert was signed by old/different CA, regenerate.
       - Use x509.checkIssued() if available, or compare issuer fields.
       Actually, the simplest check: `serverX509.issuer` should equal `caX509.subject`.
       If issuer mismatch OR domain mismatch → regenerate.

  3. If cert valid and matches: return existing cert+key (no UAC, no regen).

  4. If cert needs regeneration: call generateCaSignedCert(config, caCert, caKey) and save.
```

**2. Replace `generateCertificate()` with `generateCaSignedCert(config, caCert, caKey)`:**

Use `selfsigned` with the `ca` option:
```typescript
async function generateCaSignedCert(
  config: AppConfig,
  caCert: string,
  caKey: string,
): Promise<CertificateCredentials> {
  const domain = config.network.domain;
  const attributes = [{ name: "commonName", value: domain }];

  const localIpAddresses = listNetworkInterfaces().map(iface => iface.address);

  const subjectAltNames = [
    { type: 2, value: domain },
    { type: 2, value: "localhost" },
    { type: 7, ip: "127.0.0.1" },
    ...localIpAddresses.map(ip => ({ type: 7, ip })),
  ];

  const notBeforeDate = new Date();
  const notAfterDate = new Date();
  notAfterDate.setDate(notAfterDate.getDate() + 825); // Apple max

  const pems = await generate(attributes, {
    keySize: 2048,
    notBeforeDate,
    notAfterDate,
    extensions: [
      {
        name: "basicConstraints",
        cA: false,
      },
      {
        name: "subjectAltName",
        altNames: subjectAltNames,
      },
    ],
    ca: { cert: caCert, key: caKey }, // <-- Sign with our CA
  });

  logger.info("CA-signed server certificate generated", {
    commonName: domain,
    sanCount: subjectAltNames.length,
    validDays: 825,
  });

  return { key: pems.private, cert: pems.cert };
}
```

**3. Remove the old `generateCertificate()` function** — it is fully replaced by `generateCaSignedCert`.

**4. Update `certMatchesDomain` or add `certIsValid(certPem, domain, caCertPem) -> boolean`:**
Check both domain match AND issuer match in a single function. This ensures that if the user had an old self-signed cert, it gets regenerated on first run with the new CA.

**5. `server.ts` — no changes needed.** The `loadOrGenerateCert(basePath, config)` signature is unchanged. The server already calls it and uses the returned `{ key, cert }`.

**6. `index.ts` — add CA cleanup to graceful shutdown (best-effort):**
In the existing `removeHostsEntry()` call during shutdown, do NOT remove the CA from the store on every shutdown. The CA should persist across restarts. Only provide `removeCaFromStore()` as a utility for explicit uninstall scenarios.

Actually, do NOT wire removeCaFromStore into shutdown. The CA is intentionally persistent. Just ensure it is exported from trustedCa.ts for future uninstall use.

**7. Handle the "CA cert removed from store by user" case:**
`ensureCaReady` already handles this: it checks `isCaInstalledInStore()` every time and re-installs if missing. This means if a user manually removes the CA from certmgr, the next server start will trigger one UAC prompt to re-install it.

**Key things to NOT do:**
- Do NOT change the `CertificateCredentials` interface — it stays as `{ key, cert }`
- Do NOT change the `loadOrGenerateCert` function signature
- Do NOT remove `certMatchesDomain` — it is still useful, just enhanced with issuer check
- Do NOT store the CA cert in the server's TLS config — only the server cert goes to HTTPS. The CA is in the Windows store.
  </action>
  <verify>
- `npx tsc --noEmit` passes with no errors in sidecar/
- `cd sidecar && npm run build` succeeds (if build script exists)
- Manually test: delete `src-tauri/ca-cert.pem`, `src-tauri/ca-key.pem`, `src-tauri/cert.pem`, `src-tauri/key.pem`, then run sidecar. Should:
  1. Generate CA keypair (ca-cert.pem + ca-key.pem appear)
  2. Trigger one UAC prompt to install CA
  3. Generate server cert signed by CA (cert.pem + key.pem appear)
  4. Server starts on HTTPS with no code errors
- Verify with: `openssl x509 -in src-tauri/cert.pem -noout -issuer` should show "CN=ChurchAudioStream Local CA"
- Verify CA in store: `certutil -store Root "ChurchAudioStream Local CA"` returns 0
- Open `https://church.audio:7777` in browser — should show valid cert (green lock), no warnings
  </verify>
  <done>
Server certificates are signed by a local Root CA instead of being self-signed. The CA is auto-generated on first run, installed into Windows Trusted Root store via UAC, and persists across restarts. Domain changes regenerate only the server cert (no UAC). Browsers on the LAN show trusted HTTPS with no security warnings.
  </done>
</task>

</tasks>

<verification>
1. Fresh start test: Delete all .pem files from src-tauri/, run sidecar. Expect one UAC prompt, then `https://church.audio:7777` loads with green lock in Chrome/Edge.
2. Restart test: Stop and restart sidecar. Expect NO UAC prompt, server starts with existing certs.
3. Domain change test: Change `network.domain` in config.json, restart sidecar. Expect NO UAC prompt, new cert.pem generated with new domain SAN.
4. CA removal test: Open certmgr.msc, delete "ChurchAudioStream Local CA" from Trusted Root. Restart sidecar. Expect one UAC prompt to re-install CA.
5. Cert chain validation: `openssl verify -CAfile src-tauri/ca-cert.pem src-tauri/cert.pem` returns OK.
</verification>

<success_criteria>
- Zero browser security warnings when accessing `https://church.audio:7777` from any device that trusts the CA
- Only ONE UAC prompt on first run (or after CA removal from store)
- Domain changes do not trigger UAC
- Subsequent runs with valid CA skip all elevation
- TypeScript compiles, no regressions in existing server startup flow
</success_criteria>

<output>
After completion, create `.planning/quick/002-trusted-root-ca-for-https/002-SUMMARY.md`
</output>
