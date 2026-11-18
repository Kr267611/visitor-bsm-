# Phase 1 acceptance checklist

Run on staging with real devices: a guard phone, a host phone, a visitor phone and a desk browser. Mark each item pass or fail.

## A. Pre-invited visitor

- [ ] A host can create an invite from both the app and the web.
- [ ] The visitor receives an SMS link; no app install is needed.
- [ ] The visitor's camera photo uploads; no pass is issued without consent.
- [ ] The pass shows the QR, host, premises and time correctly.
- [ ] The guard scans the QR and sees the photo and name; the whole flow takes under 30 seconds.
- [ ] The host gets a push: the visitor has arrived at the gate.
- [ ] The visitor appears under "Inside" on the desk without a refresh.

## B. Walk-in

- [ ] Returning visitor: details fill in as soon as the number is entered.
- [ ] New visitor: no entry without OTP, photo, host and consent.
- [ ] The host gets a push; approving updates the guard's screen immediately.
- [ ] The guard sees the host's note.
- [ ] After a rejection, no check-in button is shown.
- [ ] No response: reminder at 90 seconds, backup person at 3 minutes, "Call the host" on the desk at 5 minutes.
- [ ] Without the app, the host gets an SMS link and can approve on the web.

## C. Check-out

- [ ] Check-out by scanning the QR in "Exit" mode at the gate.
- [ ] Check-out still works after the pass time has ended.
- [ ] Check-out without QR from both the desk and the guard app.

## D. Edge cases

- [ ] Same QR scanned again in "Entry" mode: shows "already checked in" with the time and gate.
- [ ] Expired pass and pass for another premises: clear messages.
- [ ] Internet drops during a scan: "Entry not confirmed", and rescanning does not create a second entry.
- [ ] Internet fully down: the guard uses the paper register (no offline mode yet).
- [ ] Camera permission denied: the check-in-without-QR path is offered.
- [ ] SMS gateway fails: check-in is not blocked and the message is retried.
- [ ] Admin blocks a device: the guard's phone returns to sign-in immediately.
- [ ] Same QR at two gates at once: only one entry.

## E. Multi-business (foundation)

- [ ] Sign in with a password and with OTP; a person in two businesses chooses one after the password/OTP.
- [ ] The premises switcher changes every list and the live desk.
- [ ] A module missing from the plan shows "Access restricted" and is hidden from the menu.
- [ ] One business never sees another business's visits, members, premises or photos.

## F. Speed and network

- [ ] Gate scan from India: p95 under 2 seconds.
- [ ] Full flow on both Jio and Airtel.
- [ ] The desk list keeps updating by polling during a Render deploy.

## G. Screens

- [ ] Web: visitor page at phone width, desk on desktop, in both light and dark mode.
- [ ] Mobile: use the guard screen in sunlight and with one hand.
