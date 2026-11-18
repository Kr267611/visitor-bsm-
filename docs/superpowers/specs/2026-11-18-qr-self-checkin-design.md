# QR self check-in: design

Status: approved direction from the user ("build most of Visitorz.io's QR module, and do it better"). This is phase D's first slice.

## What Visitorz.io does (from the PRD and their public pages)

1. A QR code is printed at the entrance. The visitor scans it with the phone camera; no app.
2. The page checks the visitor's GPS against the premises boundary, then verifies the mobile number by OTP.
3. Short form (fields set per premises), selfie, consent, host chosen from the staff directory. Returning visitors are prefilled.
4. The host is notified (WhatsApp/SMS/push/web) and accepts, asks the visitor to wait, or rejects. No answer escalates to the next level.
5. The visitor receives a QR e-badge; security scans it at the gate. Pre-registered visitors are checked in automatically when they scan.
6. Exit: QR check-out, meeting feedback, Google review prompt; auto check-out at a set time.

Weak spots found in their public material: the printed QR is static (it can be photographed and shared), GPS is the only location proof (it can be spoofed), the visitor's waiting and rejection screens are not described, watchlist and capacity only alert, and offline behaviour of self check-in is unclear.

## What we build now (slice 1)

The visitor flow, end to end, on the web (no app):

1. **Premises QR poster.** Admin → Premises & gates → "QR poster" opens a printable page with the premises QR. The QR points to `/p/<business-slug>/<premises-slug>`.
2. **Landing.** The page shows the business and premises name. It is "Currently unavailable" when the business is inactive, the plan lacks the visitor desk module, or the monthly visit limit is reached, and "Closed" outside visiting hours.
3. **Mobile + OTP.** OTP by SMS (same DLT text as the guard walk-in OTP). Rate-limited per phone, like every OTP today.
4. **Location (only when the premises has a geofence).** The browser asks for location; the API rejects positions outside the radius. Low-accuracy fixes are allowed only when the whole accuracy circle overlaps the boundary.
5. **Details.** Name, company, purpose (premises purpose list), photo (required for a new visitor; returning visitors keep their photo), host search limited to that premises, consent.
6. **Submit.** A self check-in visit (type `SELF`) is created. If the premises requires approval, it is `PENDING_APPROVAL`, the host gets the same approval push as for walk-ins, and the existing reminder → backup person → reception-call escalation runs. If approval is off, the visit is `APPROVED` at once.
7. **Waiting screen = the visitor's status link.** The visitor is taken to `/v/<token>` (the page invited visitors already use) and also gets the link by SMS. The page refreshes every few seconds while pending and turns into the QR pass the moment the host approves. Rejection shows a clear message.
8. **Gate.** The guard scans the pass exactly as for invites (signed, time-bound, per-premises pass; replay-safe).
9. **Self check-out.** Scanning the same premises QR again, after OTP, finds the visitor's active visit and offers "Check out" (no separate exit QR).

### Better than Visitorz in this slice

- **The pass is not the printed QR.** The poster QR only starts the flow. Entry still needs OTP on the visitor's own phone, then host approval, then a signed, single-visit, time-bound pass scanned by the guard. A photographed poster gets nobody inside.
- **Geofence uses GPS accuracy,** so a weak indoor fix is not rejected by mistake and a far-away position is.
- **One active visit per person per premises.** Scanning again shows the existing pass or check-out instead of creating duplicates.
- **A real waiting screen** that updates itself, plus the same link by SMS in case the visitor closes the browser.
- **Business isolation by design:** the session token is bound to one premises, and every write runs inside that premises' business (fail-closed tenant client).

### Later slices (not now)

- Rotating kiosk QR on a screen (changes every 30 seconds) for high-security premises: defeats GPS spoofing and shared photos.
- Host "Wait" decision with a message to the visitor, assets allowed, notes for reception.
- Custom form builder fields, ID upload, watchlist blocking (not just alerts), capacity blocking.
- Feedback and Google review after check-out, auto check-out job, member QR.
- Kiosk mode (tablet PWA) and printed badges.

## API

All public, rate-limited, under `/public/premises/:businessSlug/:premisesSlug`:

| Method | Path | Purpose |
|---|---|---|
| GET | `` | Premises name, business name, purposes, whether location is needed, availability |
| POST | `/otp` | Send OTP to `{ phone }` |
| POST | `/verify` | `{ phone, otp, location? }` → session token (20 min, bound to premises + phone), returning-visitor prefill, active visit if any |
| GET | `/hosts?q=` | Hosts of this premises (name, department) — session required |
| POST | `/photo` | Selfie upload — session required |
| POST | `/check-in` | Create the visit — session required; returns the status-link token |
| POST | `/check-out` | Check out the active visit — session required |

New database value: `VisitType.SELF`. New SMS template: `SELF_CHECKIN_LINK`.

## Rules

- Never reveal whether a phone belongs to anyone until OTP is verified.
- The session token is a JWT with its own audience (`self-checkin`), so it can never be used as a sign-in token, and the reverse.
- Photo keys from a session must live under that session's prefix.
- Approving a `SELF` visit keeps its link token (the visitor is watching that page); invites and walk-ins keep today's behaviour.
