# Tauri Updater Signing Key — One-Time Setup

CI workflow `.github/workflows/release.yml` requires two repository secrets to
sign auto-update bundles. This runbook is the canonical setup.

> **WARNING — pubkey coordination.** The public key is already embedded in
> `src-tauri/tauri.conf.json` (`plugins.updater.pubkey`, line 53), shipped in
> commit `4d9c69b`. Existing installs verify update signatures against that
> embedded pubkey. **Do NOT regenerate the keypair without coordinating a
> tauri.conf.json pubkey update PLUS a transition release signed by the OLD
> key.** Skipping the transition release leaves all existing installs unable
> to update (signature mismatch -> Tauri client rejects -> silent skip).

---

## 1. Generate the keypair (LOCAL machine, ONCE)

Pick a strong password. The password protects the private key at rest.

    npm run tauri signer generate -- -w ~/.tauri/churchaudiostream.key

Outputs:

- `~/.tauri/churchaudiostream.key` — PRIVATE. Never commit. Never share. Back up
  to a secure offline location (password manager attachment, encrypted USB).
- `~/.tauri/churchaudiostream.key.pub` — PUBLIC. This value already lives in
  `src-tauri/tauri.conf.json:53`.

---

## 2. Verify the public key matches tauri.conf.json

    cat ~/.tauri/churchaudiostream.key.pub

Compare verbatim to the `plugins.updater.pubkey` field in
`src-tauri/tauri.conf.json` (currently a single base64 line beginning
`dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6...`).

If the values do NOT match: the pubkey already in tauri.conf.json belongs to a
different keypair (someone else generated it earlier). Stop. Coordinate with
the original key holder before proceeding — see warning at top of file.

---

## 3. Add private key + password to GitHub repo secrets

Settings -> Secrets and variables -> Actions -> New repository secret.

| Secret name                            | Value                                                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `TAURI_SIGNING_PRIVATE_KEY`            | Full content of `~/.tauri/churchaudiostream.key` (cat the file, paste verbatim including header lines) |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`   | The password used in step 1. Empty string `` is acceptable if no password was set, but the secret MUST EXIST (Pitfall 2) |

---

## 4. Verify by pushing a smoke tag

See Section 6 below — Manual UAT Smoke Recipe.

---

## 5. Key rotation (FUTURE — not Phase 5 work)

To rotate the signing keypair without breaking existing installs:

1. Generate a NEW keypair on a local machine: `npm run tauri signer generate -- -w ~/.tauri/churchaudiostream-new.key`.
2. Update `src-tauri/tauri.conf.json` `plugins.updater.pubkey` to the NEW
   public key value.
3. Ship a TRANSITION release signed with the OLD private key (existing users
   download + install + their NEW install now contains the NEW pubkey).
4. ONLY after the transition release has propagated to all known users (give
   it weeks if user base is heterogeneous), rotate the GitHub secret
   `TAURI_SIGNING_PRIVATE_KEY` to the NEW private key.
5. The next release after rotation is signed with the NEW key — clients now
   verify against the NEW embedded pubkey.

Skipping step 3 = orphans every existing installation. They cannot accept
updates because their embedded pubkey no longer matches the signature.

---

## 6. Manual UAT Smoke Recipe

Per CONTEXT.md D-06 — agent-runnable on demand AFTER repo secrets configured.
Not part of the automated CI gate (would burn workflow minutes + produce real
release artifacts every push).

```bash
# 1. Tag a smoke release LOCALLY (do not bump tauri.conf.json version)
git tag v0.0.1-smoketest
git push origin v0.0.1-smoketest

# 2. Watch workflow run
gh run watch  # or: open github.com/.../actions in browser

# 3. Verify release contents (within ~3 min)
gh release view v0.0.1-smoketest --json assets --jq '.assets[].name'
# EXPECT (3 entries):
#   ChurchAudioStream_0.0.1-smoketest_x64-setup.exe
#   ChurchAudioStream_0.0.1-smoketest_x64-setup.exe.sig
#   latest.json

# 4. Inspect manifest
gh release download v0.0.1-smoketest -p latest.json -O - | jq .
# EXPECT structure:
#   { "version": "0.0.1-smoketest", "notes": "...", "pub_date": "2026-...",
#     "platforms": { "windows-x86_64": { "signature": "...", "url": "https://..." } } }

# 5. Cross-validate against Rust deserializer (forward-compat)
gh release download v0.0.1-smoketest -p latest.json -O - > /tmp/manifest.json
cd src-tauri && cargo test --lib manifest_deserializes_from_json -- --exact
# (existing test reads inline json; for true round-trip, write a one-off test
#  that reads /tmp/manifest.json — optional for Phase 5)

# 6. Cleanup (manifest test was the goal, no need to keep the release)
gh release delete v0.0.1-smoketest --yes --cleanup-tag
# (--cleanup-tag also deletes the remote tag; if it does NOT, also run:)
git push --delete origin v0.0.1-smoketest
git tag -d v0.0.1-smoketest
```

**What this recipe verifies:**

- Tag-push trigger fires (D-01)
- tauri-action successfully signs + uploads installer + sig
- Generator produces valid manifest
- gh upload + publish chain works
- Asset naming convention matches what client `current_platform_key()` looks up

**What it does NOT verify:**

- Actual installer install on a clean Windows machine (manual, separate)
- Tauri client picking up the update (requires running an OLDER build of the
  app pointing at the same endpoint — manual verification cycle, deferred)
