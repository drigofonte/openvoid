---
date: 2026-05-24
status: draft
related:
  - docs/architecture/secrets-threat-model.md
  - docs/architecture/secrets-sequence-diagrams.md
---

# Secrets Management — Device & Browser Requirements

> **Draft.** Passkey enrolment with the WebAuthn PRF extension is a hard prerequisite for using OpenVoid. There is no degraded-mode fallback; users whose browser or authenticator cannot satisfy PRF cannot create an account. This document specifies the support matrix and the user-facing handling for unsupported devices.

## 1. Why this is a hard gate

The threat model in [secrets-threat-model.md](./secrets-threat-model.md) rests on a user-derived KEK that the platform never persists. That guarantee requires WebAuthn-PRF — there is no software-only substitute that preserves the same threat properties.

The previous draft of this design carried a tiered fallback for users without PRF support. That fallback has been removed for two reasons:

1. **It made the threat model harder to reason about.** Each residual-risk discussion had to be repeated per-tier, and "the platform has access to your encryption keys" is an honest but corrosive thing to say to half the users.
2. **OpenVoid's audience is sophisticated users accelerating their own work**, not a mass-market no-code product. The audience can reasonably be expected to use a passkey-capable browser and device; the audience that can't probably isn't well-served by BYOK + per-app secret integration anyway.

The price of this choice is real exclusion of some users. This document is the honest accounting of who and why.

## 2. Support matrix (as of May 2026)

### Browsers

| Browser | Support | Notes |
|---|---|---|
| Chrome / Edge / Brave / Chromium derivatives | ✅ since Chrome 116 (Aug 2023) | Stable |
| Safari (macOS 14+, iOS 17+) | ✅ since Safari 18 (Sept 2024) | Stable |
| Firefox | ✅ since Firefox 135 (Q1 2025) | Some Firefox-on-Linux configurations may have rough edges depending on the platform authenticator backend; treat as supported with a known caveat |
| Niche browsers (Opera, Vivaldi, embedded WebViews) | ⚠️ Inherits from Chromium/WebKit/Gecko — uneven |

### Authenticators (`hmac-secret` extension)

| Authenticator class | Support |
|---|---|
| Touch ID (macOS 13+) | ✅ |
| Face ID (iOS 17+) | ✅ |
| Windows Hello (Win 10 1903+) | ✅ |
| Android (with Google Password Manager) | ✅ |
| YubiKey 5 series and later | ✅ |
| YubiKey 4 and older U2F-only keys | ❌ |

## 3. User groups excluded by this requirement

We expect to lose access to (or be inaccessible from) the following:

1. **Older browser / OS users** — Chrome <116, Safari <18, Firefox <135, pre-Win10 / pre-macOS-13 / pre-iOS-17. Most can update; some cannot due to hardware age.
2. **Users with U2F-only hardware keys** — YubiKey 4 and similar. Frustratingly, these are often security-conscious users who *care* about strong crypto but happen to own legacy hardware.
3. **Accessibility-affected users** for whom biometric authentication is impractical. Platform authenticators generally support PIN fallback that exposes PRF, so this gap is smaller than it first appears — but it is not zero.
4. **Corporate / managed-device users** in environments where IT policy blocks passkey enrolment outside an approved IDP or blocks the platform authenticators we depend on.
5. **Privacy-conscious users avoiding platform identity stores** (iCloud Keychain, Google Password Manager, Microsoft Account). These users can usually use a YubiKey 5; the path requires extra equipment.
6. **Shared / public computer users** — passkey enrolment on a non-personal device is incorrect. These users have no path until they reach a personal device.
7. **Geographic exclusions** — countries with restricted access to Apple / Google identity services. Hardware keys mitigate but availability varies.
8. **Users without a smartphone *and* without a desktop with platform auth *and* without a hardware key** — small in OpenVoid's developer cohort, real elsewhere.

For OpenVoid's stated audience (sophisticated users accelerating their own work), the structural exclusion is probably under 10%. We accept this trade explicitly.

## 4. The unsupported-device experience

When the PRF probe fails during signup (Diagram 1 in [secrets-sequence-diagrams.md](./secrets-sequence-diagrams.md)), the user is routed to `/signup/device-not-supported`. The page should:

- **Acknowledge plainly** that their device doesn't meet OpenVoid's requirements, without making them feel at fault.
- **Specify what works** — the table above, condensed and friendly. Lead with the broadest-coverage options (a recent version of Chrome/Safari/Edge with Touch ID, Face ID, or Windows Hello).
- **Offer a retry path** — "Come back from a supported device" with an option to email themselves a reminder link.
- **Not partially create the account.** The signup transaction is rolled back so the user can start cleanly next time.

**Critical UX rule:** the messaging must not blame the user, must not pretend OpenVoid is universally accessible, and must not offer a "skip this step" link. The honesty is the point.

## 5. What we tell users on the marketing surface

The landing page and the signup page should both make the requirement visible *before* the user invests effort:

- **Landing page:** a small "Built for [list of supported browsers/devices]" line near the signup CTA, linking to this page.
- **Signup page:** a one-line preview ("You'll need Touch ID, Face ID, Windows Hello, or a YubiKey 5 to complete signup") before the OAuth buttons.

This is the cost of choosing a strong security model. We pay it upfront in honest communication so we don't pay it later in support tickets from frustrated users who got halfway through onboarding before hitting a wall.

## 6. Pending revision points

1. **PRF probe robustness.** Some authenticators behave inconsistently between registration and authentication (returning PRF on register but not on subsequent auth, or vice versa). The probe needs to handle this and surface meaningful errors rather than silently failing later.
2. **Corporate-IT carve-out path.** A future enterprise tier may need to support SSO-with-hardware-key flows where the user's IT department wants to provision the authenticator. Not in scope for v1 but worth flagging as a known future requirement.
3. **Accessibility audit.** This document assumes biometric/PIN authenticators are universally usable. A proper accessibility review (WCAG, screen-reader compatibility of the WebAuthn dialog, alternative input methods) is needed before public release.
